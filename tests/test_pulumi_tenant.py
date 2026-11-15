"""Pruebas del motor Pulumi sin tocar AWS ni ejecutar el CLI: todo se simula con mocks."""
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))
import pulumi_tenant as motor

IDS = {'frontend': 'i-0123456789abcdef0', 'backend': 'i-0123456789abcdef1', 'database': 'i-0123456789abcdef2'}
AMI = 'ami-0123456789abcdef0'


def solicitud():
    return {'tenant_slug': 'zz-prueba', 'request_id': 'req-1', 'region': 'us-east-1', 'engine': 'pulumi',
            'key_pair_name': 'llave', 'plan_snapshot': {'slug': 'basico'}, 'images': {rol: {'ami_id': AMI} for rol in motor.ROLES}}


def salidas():
    datos = {'vpc_id': 'vpc-0abc', 'public_subnet_id': 'subnet-pub', 'private_subnet_id': 'subnet-priv'}
    for rol in motor.ROLES:
        datos[f'{rol}_id'] = IDS[rol]
        datos[f'{rol}_security_group_id'] = f'sg-{rol}'
    return datos


def instancias(etiqueta='zz-prueba'):
    lista = []
    for n, rol in enumerate(motor.ROLES, 10):
        item = {'InstanceId': IDS[rol], 'ImageId': AMI, 'VpcId': 'vpc-0abc', 'PrivateIpAddress': f'10.42.1.{n}',
                'SubnetId': 'subnet-pub' if rol == 'frontend' else 'subnet-priv', 'State': {'Name': 'running'},
                'Tags': [{'Key': 'Project', 'Value': 'proyecto-modulo-2'}, {'Key': 'TenantId', 'Value': etiqueta},
                         {'Key': 'RunId', 'Value': 'req-1'}, {'Key': 'Role', 'Value': rol}]}
        if rol == 'frontend':
            item['PublicIpAddress'] = '198.51.100.7'
        lista.append(item)
    return {'Reservations': [{'Instances': lista}]}


class PulumiTenantTests(unittest.TestCase):
    def test_arma_el_resultado_con_los_datos_verificados_de_aws(self):
        with patch.object(motor, 'aws', return_value=instancias()):
            resultado = motor.build_result(solicitud(), salidas())
        self.assertEqual(resultado['engine'], 'pulumi')
        self.assertEqual(resultado['nodes']['frontend']['public_ip'], '198.51.100.7')
        self.assertIsNone(resultado['nodes']['backend']['public_ip'])
        self.assertEqual(resultado['state_reference']['backend'], 'pulumi-local')
        self.assertEqual(resultado['network']['subnet_ids'], ['subnet-pub', 'subnet-priv'])

    def test_rechaza_instancias_de_otro_tenant(self):
        with patch.object(motor, 'aws', return_value=instancias(etiqueta='otro')):
            with self.assertRaises(ValueError):
                motor.build_result(solicitud(), salidas())

    def test_rechaza_tres_roles_con_la_misma_instancia(self):
        datos = salidas()
        datos['backend_id'] = datos['frontend_id']
        with self.assertRaises(ValueError):
            motor.build_result(solicitud(), datos)

    def _ejecutar(self, argumentos):
        llamadas = []
        def falso(comando, env, **kwargs):
            llamadas.append(comando)
            return json.dumps(salidas()) if comando[:2] == ['stack', 'output'] else ''
        with tempfile.TemporaryDirectory() as raiz, patch.object(motor, 'HANDOFF', Path(raiz)), \
                patch.object(motor, 'load_handoff', return_value=(solicitud(), {}, 'digest', Path(raiz), {})), \
                patch.object(motor, 'scan_handoff', return_value={'status': 'clean', 'content_sha256': 'digest'}), \
                patch.object(motor, 'preflight', return_value='us-east-1a'), patch.object(motor, 'check_account'), \
                patch.object(motor, 'python_command', return_value='python'), patch.object(motor, 'pulumi', side_effect=falso), \
                patch.object(motor, 'aws', return_value=instancias()), \
                contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            codigo = motor.main(argumentos)
        return codigo, llamadas

    def test_validar_solo_hace_vista_previa_y_retira_el_stack(self):
        codigo, llamadas = self._ejecutar(['validate', '--tenant', 'zz-prueba', '--account-id', '123456789012', '--ssh-cidr', '8.8.8.8/32'])
        self.assertEqual(codigo, 0)
        nombres = [comando[0] for comando in llamadas]
        self.assertIn('preview', nombres)
        self.assertNotIn('up', nombres)
        self.assertEqual(llamadas[-1][:2], ['stack', 'rm'])

    def test_crear_exige_ip_del_operador(self):
        codigo, llamadas = self._ejecutar(['create', '--tenant', 'zz-prueba', '--account-id', '123456789012'])
        self.assertEqual(codigo, 2)
        self.assertEqual(llamadas, [])

    def test_eliminar_exige_confirmar_el_mismo_tenant_y_propiedad(self):
        with tempfile.TemporaryDirectory() as raiz, patch.object(motor, 'HANDOFF', Path(raiz)):
            propietario = Path(raiz) / 'zz-prueba' / 'pulumi'
            propietario.mkdir(parents=True)
            (propietario / 'owner.json').write_text(json.dumps({'account_id': '123456789012', 'request_id': 'req-1', 'stack': 'zz-prueba'}), encoding='utf-8')
            llamadas = []
            with patch.object(motor, 'load_handoff', return_value=(solicitud(), {}, 'd', Path(raiz), {})), patch.object(motor, 'check_account'), \
                    patch.object(motor, 'python_command', return_value='python'), \
                    patch.object(motor, 'pulumi', side_effect=lambda comando, env, **k: llamadas.append(comando) or ''), \
                    contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(motor.main(['destroy', '--tenant', 'zz-prueba', '--account-id', '123456789012', '--confirm', 'otro']), 2)
                self.assertNotIn('destroy', [c[0] for c in llamadas])
                self.assertEqual(motor.main(['destroy', '--tenant', 'zz-prueba', '--account-id', '123456789012', '--confirm', 'zz-prueba']), 0)
            self.assertIn('destroy', [c[0] for c in llamadas])

    def test_eliminar_sin_registro_de_propiedad_no_opera_por_nombre(self):
        with tempfile.TemporaryDirectory() as raiz, patch.object(motor, 'HANDOFF', Path(raiz)):
            with patch.object(motor, 'load_handoff', return_value=(solicitud(), {}, 'd', Path(raiz), {})), patch.object(motor, 'check_account'), \
                    patch.object(motor, 'pulumi') as cli, contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(motor.main(['destroy', '--tenant', 'zz-prueba', '--account-id', '123456789012', '--confirm', 'zz-prueba']), 2)
            cli.assert_not_called()

    def test_no_esta_listo_sin_cli_o_sin_interprete(self):
        with patch.object(motor, 'pulumi_binary', return_value=None), patch.object(motor, 'python_command', return_value='python'):
            self.assertFalse(motor.ready())
        with patch.object(motor, 'pulumi_binary', return_value='pulumi'), patch.object(motor, 'python_command', return_value=None):
            self.assertFalse(motor.ready())

    def test_el_programa_no_abre_el_puerto_5432_a_internet(self):
        import security_scan
        datos = security_scan.infrastructure_snapshot('pulumi')
        self.assertIn('infrastructure/pulumi/__main__.py', datos)
        self.assertFalse(security_scan.detect_postgres_5432_exposure(datos))
        peligroso = {'x.py': b"sg = {'from_port': 5432, 'to_port': 5432, 'cidr_blocks': ['0.0.0.0/0']}"}
        self.assertTrue(security_scan.detect_postgres_5432_exposure(peligroso))


if __name__ == '__main__':
    unittest.main()
