"""Pruebas del worker de ciclo de vida: ninguna llamada llega a AWS; todo se simula con mocks."""
import contextlib
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))
import lifecycle_worker as worker

ID_RESPALDO = '11111111-2222-4333-8444-555555555555'
IDS = {'frontend': 'i-0123456789abcdef0', 'backend': 'i-0123456789abcdef1', 'database': 'i-0123456789abcdef2'}


def result():
    return {'nodes': {role: {'instance_id': IDS[role], 'private_ip': '10.0.0.%d' % n, 'public_ip': '198.51.100.7' if role == 'frontend' else None}
                      for n, role in enumerate(worker.ROLES, 10)},
            'network': {'vpc_id': 'vpc-0abc', 'subnet_ids': [], 'security_group_ids': []}}


def source(action='suspend', simulate=False, with_result=True, backup=None):
    return {'action': action, 'simulate': simulate, 'backup': backup, 'result': result() if with_result else None,
            'tenant': {'slug': 'zz-prueba', 'region': 'us-east-1', 'engine': 'cloudformation', 'request_id': 'req', 'plan_slug': 'basico'}}


def aws_instances(tag_slug='zz-prueba', state='running', vpc='vpc-0abc'):
    return [{'InstanceId': IDS[role], 'VpcId': vpc, 'State': {'Name': state}, 'PrivateIpAddress': '10.0.0.1',
             'Tags': [{'Key': 'Project', 'Value': 'proyecto-modulo-2'}, {'Key': 'TenantId', 'Value': tag_slug}]}
            for role in worker.ROLES]


def run_main(payload):
    stdin = io.StringIO(json.dumps(payload))
    out = io.StringIO()
    with patch.object(sys, 'stdin', stdin), contextlib.redirect_stdout(out):
        code = worker.main()
    return code, [json.loads(line) for line in out.getvalue().splitlines()]


class LifecycleWorkerTests(unittest.TestCase):
    def setUp(self):
        worker.STATE.update({'mutated': False, 'simulate': False})

    def test_valida_el_contrato_de_entrada(self):
        with self.assertRaises(worker.DemoError):
            worker.validate({'action': 'borrar-todo'})
        bad = source()
        bad['result']['nodes']['frontend']['instance_id'] = 'i-DROP'
        with self.assertRaises(worker.DemoError):
            worker.validate(bad)
        with self.assertRaises(worker.DemoError):
            worker.validate(source('resume', with_result=False))
        worker.validate(source('delete', with_result=False))

    def test_rechaza_instancias_de_otro_tenant_sin_cambiar_nada(self):
        with patch.object(worker, 'instances', return_value=aws_instances(tag_slug='otro-tenant')), \
                patch.object(worker, 'aws_ec2') as aws:
            with self.assertRaises(worker.DemoError):
                worker.suspend(source()['tenant'], result())
        aws.assert_not_called()
        self.assertFalse(worker.STATE['mutated'])

    def test_rechaza_instancias_fuera_de_la_vpc_registrada(self):
        with patch.object(worker, 'instances', return_value=aws_instances(vpc='vpc-ajena')):
            with self.assertRaises(worker.DemoError):
                worker.verify_ownership('us-east-1', result(), 'zz-prueba')

    def test_suspender_detiene_solo_los_ids_exactos(self):
        with patch.object(worker, 'instances', return_value=aws_instances()), patch.object(worker, 'aws_ec2') as aws, \
                contextlib.redirect_stdout(io.StringIO()):
            worker.suspend(source()['tenant'], result())
        stop = aws.call_args_list[0].args
        self.assertEqual(stop[1], 'stop-instances')
        self.assertEqual(sorted(stop[3:]), sorted(IDS.values()))
        self.assertTrue(worker.STATE['mutated'])

    def test_reanudar_devuelve_las_direcciones_nuevas(self):
        started = aws_instances()
        for item in started:
            item['PublicIpAddress'] = '198.51.100.9' if item['InstanceId'] == IDS['frontend'] else None
            if not item['PublicIpAddress']:
                del item['PublicIpAddress']
        with patch.object(worker, 'instances', return_value=started), patch.object(worker, 'aws_ec2'), \
                patch.object(worker, 'reconfigure_application') as reconfigure, contextlib.redirect_stdout(io.StringIO()):
            nodes = worker.resume(source('resume')['tenant'], result())
        reconfigure.assert_called_once()
        self.assertEqual(reconfigure.call_args.args[2]['frontend']['public_ip'], '198.51.100.9')
        self.assertEqual(nodes['frontend']['public_ip'], '198.51.100.9')
        self.assertEqual(set(nodes), set(worker.ROLES))

    def test_fallo_antes_de_cambiar_algo_es_seguro(self):
        with patch.object(worker, 'check_account', side_effect=worker.DemoError('La cuenta AWS activa no coincide.')), \
                patch.dict('os.environ', {'DEMO_PROVISIONING_LOCAL': 'true', 'AWS_EXPECTED_ACCOUNT_ID': '123456789012'}):
            code, events = run_main(source())
        self.assertEqual(code, 1)
        self.assertEqual(events[-1]['status'], 'failed')
        self.assertIs(events[-1]['safe'], True)

    def test_fallo_despues_de_cambiar_algo_no_es_seguro(self):
        def fallar(*args, **kwargs):
            worker.STATE['mutated'] = True
            raise worker.DemoError('El motor falló.')
        with patch.object(worker, 'suspend', side_effect=fallar), \
                patch.object(worker, 'check_account'), \
                patch.dict('os.environ', {'DEMO_PROVISIONING_LOCAL': 'true', 'AWS_EXPECTED_ACCOUNT_ID': '123456789012'}):
            code, events = run_main(source())
        self.assertEqual(code, 1)
        self.assertIs(events[-1]['safe'], False)

    def test_la_simulacion_no_toca_aws_y_lo_indica(self):
        with patch.object(worker, 'run_silent') as aws, patch.object(worker.time, 'sleep'):
            code, events = run_main(source('resume', simulate=True))
        aws.assert_not_called()
        self.assertEqual(code, 0)
        self.assertTrue(all(e['message'].startswith('[SIMULADO]') for e in events if e['stage'] != 'result'))
        self.assertTrue(events[-1]['nodes']['frontend']['public_ip'].startswith('203.0.113.'))

    def test_valida_los_datos_del_respaldo(self):
        with self.assertRaises(worker.DemoError):
            worker.validate(source('backup'))
        with self.assertRaises(worker.DemoError):
            worker.validate(source('restore', backup={'backup_id': ID_RESPALDO, 'sha256': None}))
        worker.validate(source('backup', backup={'backup_id': ID_RESPALDO, 'sha256': None}))
        worker.validate(source('restore', backup={'backup_id': ID_RESPALDO, 'sha256': 'a' * 64}))

    def test_el_comando_ssh_pasa_por_el_bastion_y_cita_los_argumentos(self):
        guion = worker.ssh_script(result(), 'database', 'sudo -n -u postgres pg_dump --format=custom control_asistencia', '/home/u/.ssh/llave.pem', ' > /tmp/x.dump')
        self.assertIn('ProxyCommand=', guion)
        self.assertIn('ubuntu@10.0.0.12', guion)
        self.assertTrue(guion.endswith(' > /tmp/x.dump'))
        with self.assertRaises(worker.DemoError):
            worker.ssh_script(result(), 'database', 'x', 'llave-relativa.pem')

    def _respaldar(self, escribir=True, falla=False):
        import tempfile
        with tempfile.TemporaryDirectory() as raiz:
            carpeta = Path(raiz)
            guiones = []
            def falso_wsl(argumentos, timeout=120, input_data=None):
                guiones.append(argumentos[-1])
                if falla:
                    raise worker.DemoError('falló')
                if escribir:
                    (carpeta / f'{ID_RESPALDO}.dump').write_bytes(b'PGDMP' + b'x' * 300)
                return b''
            with patch.object(worker, 'backup_directory', return_value=carpeta), patch.object(worker, 'instances', return_value=aws_instances()),                     patch.object(worker, 'wsl', side_effect=falso_wsl), patch.object(worker, 'wsl_path', return_value=str(carpeta)),                     patch.dict('os.environ', {'DEMO_SSH_PRIVATE_KEY_WSL_PATH': '/home/u/.ssh/llave.pem'}), contextlib.redirect_stdout(io.StringIO()):
                try:
                    salida = worker.backup(source('backup')['tenant'], result(), {'backup_id': ID_RESPALDO, 'sha256': None})
                except worker.DemoError:
                    salida = None
                return salida, guiones, sorted(p.name for p in carpeta.iterdir())

    def test_respaldar_guarda_el_dump_su_manifiesto_y_devuelve_el_checksum(self):
        salida, guiones, archivos = self._respaldar()
        self.assertEqual(salida['backup']['backup_id'], ID_RESPALDO)
        self.assertEqual(salida['backup']['size_bytes'], 305)
        self.assertEqual(len(salida['backup']['sha256']), 64)
        self.assertIn('pg_dump --format=custom control_asistencia', guiones[0])
        self.assertEqual(archivos, [f'{ID_RESPALDO}.dump', f'{ID_RESPALDO}.json'])

    def test_respaldar_rechaza_un_archivo_que_no_es_pg_dump_y_no_lo_deja(self):
        salida, _, archivos = self._respaldar(escribir=False)
        self.assertIsNone(salida)
        self.assertEqual(archivos, [])

    def test_respaldar_falla_sin_dejar_archivos_parciales(self):
        salida, _, archivos = self._respaldar(falla=True)
        self.assertIsNone(salida)
        self.assertEqual(archivos, [])

    def _restaurar(self, falla_restauracion=False, sha=None):
        import tempfile
        with tempfile.TemporaryDirectory() as raiz:
            carpeta = Path(raiz)
            archivo = carpeta / f'{ID_RESPALDO}.dump'
            archivo.write_bytes(b'PGDMP' + b'y' * 200)
            esperado = sha or worker.file_digest(archivo)
            guiones = []
            def falso_wsl(argumentos, timeout=120, input_data=None):
                guiones.append(argumentos[-1])
                if falla_restauracion and 'pg_restore' in argumentos[-1]:
                    raise worker.DemoError('falló')
                return b''
            worker.STATE.update({'mutated': False, 'simulate': False})
            with patch.object(worker, 'backup_directory', return_value=carpeta), patch.object(worker, 'instances', return_value=aws_instances()),                     patch.object(worker, 'wsl', side_effect=falso_wsl), patch.object(worker, 'wsl_path', return_value=str(archivo)),                     patch.object(worker, 'health_answers', return_value=True),                     patch.dict('os.environ', {'DEMO_SSH_PRIVATE_KEY_WSL_PATH': '/home/u/.ssh/llave.pem'}), contextlib.redirect_stdout(io.StringIO()):
                try:
                    worker.restore(source('restore')['tenant'], result(), {'backup_id': ID_RESPALDO, 'sha256': esperado})
                    error = None
                except worker.DemoError as fallo:
                    error = str(fallo)
            return error, guiones

    def test_restaurar_detiene_el_backend_restaura_en_una_transaccion_y_lo_reinicia(self):
        error, guiones = self._restaurar()
        self.assertIsNone(error)
        self.assertEqual(len(guiones), 3)
        self.assertIn('systemctl stop campus-cloud-zz-prueba.service', guiones[0])
        self.assertIn('--single-transaction', guiones[1])
        self.assertIn('--clean --if-exists', guiones[1])
        self.assertIn('systemctl start campus-cloud-zz-prueba.service', guiones[2])

    def test_si_la_restauracion_falla_el_backend_se_reinicia_y_el_tenant_queda_seguro(self):
        error, guiones = self._restaurar(falla_restauracion=True)
        self.assertIn('revirtió', error)
        self.assertIn('systemctl start', guiones[-1])
        self.assertFalse(worker.STATE['mutated'])

    def test_restaurar_rechaza_un_checksum_distinto_sin_tocar_el_tenant(self):
        error, guiones = self._restaurar(sha='0' * 64)
        self.assertIn('checksum', error)
        self.assertEqual(guiones, [])

    def test_reparar_exige_propiedad_y_reconfigura_con_las_ip_actuales(self):
        running = aws_instances()
        for item in running:
            if item['InstanceId'] == IDS['frontend']:
                item['PublicIpAddress'] = '198.51.100.20'
        with patch.object(worker, 'instances', return_value=running), patch.object(worker, 'reconfigure_application') as reconfigure,                 contextlib.redirect_stdout(io.StringIO()):
            worker.reconfigure(source('reconfigure')['tenant'], result())
        self.assertEqual(reconfigure.call_args.args[2]['frontend']['public_ip'], '198.51.100.20')
        with patch.object(worker, 'instances', return_value=aws_instances(tag_slug='otro')), patch.object(worker, 'reconfigure_application') as other:
            with self.assertRaises(worker.DemoError):
                worker.reconfigure(source('reconfigure')['tenant'], result())
        other.assert_not_called()

    def _destruir_con(self, engine):
        import tempfile
        with tempfile.TemporaryDirectory() as raiz:
            carpeta = Path(raiz) / 'output' / 'tenants' / 'zz-prueba'
            carpeta.mkdir(parents=True)
            (carpeta / 'terraform.tfvars.json').write_text('{}', encoding='utf-8')
            tenant = dict(source('delete')['tenant'], engine=engine)
            entorno = {'AWS_EXPECTED_ACCOUNT_ID': '123456789012', 'DEMO_SSH_CIDR': '8.8.8.8/32'}
            with patch.object(worker, 'ROOT', Path(raiz)), patch.object(worker, 'instances', return_value=[]),                     patch.dict('os.environ', entorno), patch.object(worker.terraform_tenant, 'main', return_value=0) as motor,                     contextlib.redirect_stdout(io.StringIO()):
                worker.destroy(tenant, result())
            return motor.call_args.args[0]

    def test_eliminar_con_terraform_y_opentofu_usa_el_mismo_motor_con_confirmacion(self):
        for engine in ('terraform', 'opentofu'):
            argumentos = self._destruir_con(engine)
            self.assertEqual(argumentos[0], 'destroy')
            self.assertEqual(argumentos[argumentos.index('--confirm') + 1], 'zz-prueba')
            self.assertIn('--ssh-cidr', argumentos)

    def test_eliminar_con_pulumi_confirma_el_mismo_tenant(self):
        with patch.object(worker, 'instances', return_value=[]), patch.dict('os.environ', {'AWS_EXPECTED_ACCOUNT_ID': '123456789012'}),                 patch.object(worker.pulumi_tenant, 'main', return_value=0) as motor_pulumi, contextlib.redirect_stdout(io.StringIO()):
            worker.destroy(dict(source('delete')['tenant'], engine='pulumi'), result())
        argumentos = motor_pulumi.call_args.args[0]
        self.assertEqual(argumentos[:3], ['destroy', '--tenant', 'zz-prueba'])
        self.assertEqual(argumentos[argumentos.index('--confirm') + 1], 'zz-prueba')

    def test_eliminar_con_terraform_falla_sin_tfvars_privado(self):
        import tempfile
        with tempfile.TemporaryDirectory() as raiz, patch.object(worker, 'ROOT', Path(raiz)), patch.object(worker, 'instances', return_value=[]),                 patch.dict('os.environ', {'AWS_EXPECTED_ACCOUNT_ID': '123456789012'}), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(worker.DemoError):
                worker.destroy(dict(source('delete')['tenant'], engine='terraform'), result())

    def test_eliminar_con_cloudformation_exige_confirmar_el_mismo_tenant(self):
        with patch.object(worker, 'instances', return_value=[]), \
                patch.dict('os.environ', {'AWS_EXPECTED_ACCOUNT_ID': '123456789012'}), \
                patch.object(worker.cloudformation_tenant, 'main', return_value=0) as engine, \
                contextlib.redirect_stdout(io.StringIO()):
            worker.destroy(source('delete')['tenant'], result())
        arguments = engine.call_args.args[0]
        self.assertEqual(arguments[:3], ['destroy', '--tenant', 'zz-prueba'])
        self.assertEqual(arguments[arguments.index('--confirm') + 1], 'zz-prueba')


if __name__ == '__main__':
    unittest.main()
