"""Pruebas del registro en vivo: formato legible, sin datos sensibles y sin ejecutar motores reales."""
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))
import live_log

ANSIBLE = """
PLAY [Configurar PostgreSQL] ***************************************************

TASK [Gathering Facts] *********************************************************
ok: [zz-db]

TASK [database : Instalar paquete psycopg2] ************************************
changed: [zz-db]

TASK [database : Crear usuario con contraseña] *********************************
changed: [zz-db] => {"changed": true, "password": "super-secreto-123"}

TASK [frontend : Emitir certificado] *******************************************
fatal: [zz-frontend]: FAILED! => {"msg": "ACME falló: puerto 80 cerrado"}

PLAY RECAP *********************************************************************
zz-db                      : ok=12   changed=5    unreachable=0    failed=0
zz-frontend                : ok=8    changed=2    unreachable=0    failed=1
"""


def recolectar(clase, texto, **opciones):
    eventos = []
    progreso = clase(eventos.append, **opciones)
    for linea in texto.splitlines():
        progreso.feed(linea)
    return eventos


class LiveLogTests(unittest.TestCase):
    def test_limpia_colores_controles_y_largo(self):
        self.assertEqual(live_log.clean('\x1b[32mok\x1b[0m\ttodo\x00bien'), 'ok todo bien')
        self.assertEqual(len(live_log.clean('x' * 1000)), live_log.LIMIT)
        self.assertEqual(live_log.clean(None), '')

    def test_omite_lineas_con_datos_sensibles(self):
        for texto in ('password=abc', 'Crear usuario con contraseña', 'token de acceso', 'vault_password_file', 'clave privada', 'BEGIN RSA PRIVATE KEY'):
            self.assertEqual(live_log.safe(texto), live_log.OMITTED, texto)
        self.assertEqual(live_log.safe('Instalar nginx'), 'Instalar nginx')

    def test_ansible_muestra_tareas_cambios_errores_y_resumen_sin_secretos(self):
        eventos = recolectar(live_log.AnsibleProgress, ANSIBLE)
        texto = '\n'.join(eventos)
        self.assertIn('Ansible · Configurar PostgreSQL', texto)
        self.assertIn('Ansible · tarea: database : Instalar paquete psycopg2', texto)
        self.assertIn('↳ cambió en zz-db', texto)
        self.assertIn('✖ ERROR en zz-frontend: {"msg": "ACME falló: puerto 80 cerrado"}'.replace('{"msg": ', '{"msg": '), texto)
        self.assertIn('zz-db : ok=12 changed=5 unreachable=0 failed=0', texto)
        self.assertNotIn('super-secreto', texto)
        self.assertNotIn('contraseña', texto)
        self.assertIn(live_log.OMITTED, texto)
        self.assertNotIn('Gathering Facts] ok', texto)

    def test_el_volumen_se_limita_pero_los_errores_y_el_resumen_siempre_salen(self):
        lineas = '\n'.join(f'TASK [rol : tarea {n}]' for n in range(50)) + '\nfatal: [h]: FAILED! => {"msg": "boom"}\nPLAY RECAP ***\nh : ok=1 changed=0 unreachable=0 failed=1'
        eventos = recolectar(live_log.AnsibleProgress, lineas, limit=10)
        self.assertEqual(len([e for e in eventos if e.startswith('Ansible · tarea')]), 10)
        self.assertTrue(any('ERROR en h' in e for e in eventos))
        self.assertTrue(any('ok=1' in e for e in eventos))

    def test_terraform_muestra_cada_recurso_y_omite_el_ruido(self):
        salida = 'aws_vpc.tenant: Creating...\naws_vpc.tenant: Still creating... [10s elapsed]\naws_vpc.tenant: Creation complete after 3s [id=vpc-0abc]\n' \
                 'module.tenant.aws_instance.frontend["frontend"]: Creating...\nApply complete! Resources: 14 added, 0 changed, 0 destroyed.\nError: algo falló'
        eventos = recolectar(live_log.TerraformProgress, salida)
        self.assertEqual(eventos[0], 'Terraform · aws_vpc.tenant: Creating')
        self.assertIn('Terraform · aws_vpc.tenant: Creation complete after 3s [id=vpc-0abc]', eventos)
        self.assertTrue(any('aws_instance.frontend' in e for e in eventos))
        self.assertIn('Terraform · Apply complete! Resources: 14 added, 0 changed, 0 destroyed.', eventos)
        self.assertFalse(any('Still creating' in e for e in eventos))
        self.assertTrue(any(e.startswith('  ✖ Error') for e in eventos))

    def test_pulumi_muestra_recursos_y_resumen(self):
        salida = '     Type                 Name       Status\n + pulumi:pulumi:Stack tcc-x   creating\n +  ├─ aws:ec2/vpc:Vpc  vpc        creating (0s)\nResources:\n    + 14 created'
        eventos = recolectar(live_log.PulumiProgress, salida)
        self.assertTrue(any('aws:ec2/vpc:Vpc vpc creating' in e for e in eventos))
        self.assertIn('Pulumi · Resources:', eventos)

    def test_eventos_de_cloudformation_en_orden_y_sin_repetir(self):
        pagina1 = {'StackEvents': [
            {'EventId': 'b', 'LogicalResourceId': 'Frontend', 'ResourceType': 'AWS::EC2::Instance', 'ResourceStatus': 'CREATE_IN_PROGRESS'},
            {'EventId': 'a', 'LogicalResourceId': 'Vpc', 'ResourceType': 'AWS::EC2::VPC', 'ResourceStatus': 'CREATE_COMPLETE'}]}
        pagina2 = {'StackEvents': [
            {'EventId': 'c', 'LogicalResourceId': 'Database', 'ResourceType': 'AWS::EC2::Instance', 'ResourceStatus': 'CREATE_FAILED', 'ResourceStatusReason': 'sin capacidad'},
            *pagina1['StackEvents']]}
        respuestas = iter([pagina1, pagina2])
        eventos = []
        vigilante = live_log.StackEvents(eventos.append, 'us-east-1', 'i3-zz')
        with patch.object(live_log.subprocess, 'run', side_effect=lambda *a, **k: subprocess.CompletedProcess(a, 0, json.dumps(next(respuestas)), '')):
            vigilante.poll()
            vigilante.poll()
        self.assertEqual(eventos, ['CloudFormation · Vpc (VPC): CREATE_COMPLETE', 'CloudFormation · Frontend (Instance): CREATE_IN_PROGRESS',
                                   'CloudFormation · Database (Instance): CREATE_FAILED — sin capacidad'])

    def test_un_error_de_aws_no_rompe_el_vigilante(self):
        vigilante = live_log.StackEvents(lambda texto: None, 'us-east-1', 'i3-zz')
        with patch.object(live_log.subprocess, 'run', side_effect=OSError):
            vigilante.poll()

    def test_stream_entrega_cada_linea_y_devuelve_el_codigo(self):
        recibidas = []
        class Registro:
            def feed(self, linea):
                recibidas.append(linea.strip())
        codigo = live_log.stream([sys.executable, '-c', 'print("uno"); print("dos"); raise SystemExit(3)'], Registro(), timeout=30)
        self.assertEqual(recibidas, ['uno', 'dos'])
        self.assertEqual(codigo, 3)


if __name__ == '__main__':
    unittest.main()
