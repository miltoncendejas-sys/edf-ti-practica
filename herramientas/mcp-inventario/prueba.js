#!/usr/bin/env node
// Prueba de punta a punta del servidor MCP del inventario.
// Arranca index.js por stdio con el cliente del propio SDK y revisa las respuestas.
// Uso: npm test   (o: node prueba.js). Sale con 0 si todo pasa y con 1 si algo falla.

import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SERVIDOR = join(AQUI, 'index.js');
const CSV_REAL = join(AQUI, '..', '..', 'docs', 'inventario-servidores.csv');

let pasaron = 0;
let fallaron = 0;
function revisa(nombre, condicion, detalle = '') {
  if (condicion) {
    pasaron++;
    console.log(`  ok    ${nombre}`);
  } else {
    fallaron++;
    console.log(`  FALLA ${nombre}${detalle ? ` -> ${detalle}` : ''}`);
  }
}

const sha256 = (ruta) => createHash('sha256').update(readFileSync(ruta)).digest('hex');
const nombres = (r) => (r.structuredContent?.servidores ?? []).map((s) => s.nombre).sort();
const texto = (r) => (r.content ?? []).map((c) => c.text ?? '').join(' ');

// Llama una herramienta que debe fallar. Regresa el mensaje de error, o null si no falló.
async function mensajeDeError(promesa) {
  try {
    const r = await promesa;
    return r.isError === true ? texto(r) : null;
  } catch (e) {
    return e.message;
  }
}

async function conecta(rutaServidor) {
  const transporte = new StdioClientTransport({
    command: process.execPath,
    args: [rutaServidor],
    cwd: tmpdir(), // otro directorio de trabajo: la ruta del CSV no debe depender de él
    stderr: 'pipe',
  });
  const cliente = new Client({ name: 'prueba-mcp-inventario', version: '1.0.0' });
  await cliente.connect(transporte);
  return cliente;
}

// --- 1. Revisión estática: index.js no escribe ------------------------------
console.log('Código de index.js');
const fuente = readFileSync(SERVIDOR, 'utf8');
const escrituras = fuente.match(
  /\b(writeFile|appendFile|createWriteStream|unlink|rmSync|rmdir|rename|mkdir|copyFile|truncate|chmod|chown|symlink)\b|\brm\(/g,
);
revisa('no usa funciones de escritura del sistema de archivos', !escrituras, escrituras?.join(', '));
const importsFs = [...fuente.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]node:fs(?:\/promises)?['"]/g)].map((m) => m[1].trim());
revisa('de node:fs solo importa readFile', importsFs.length === 1 && importsFs[0] === 'readFile', importsFs.join(' | '));
const modulosRed = fuente.match(/from\s*['"]node:(net|http|https|child_process|dgram|tls)['"]/g);
revisa('no importa módulos de red ni de procesos', !modulosRed, modulosRed?.join(', '));

// --- 2. Servidor real contra docs/inventario-servidores.csv -----------------
const hashAntes = sha256(CSV_REAL);
const cliente = await conecta(SERVIDOR);

console.log('Herramientas publicadas');
const { tools } = await cliente.listTools();
revisa('son exactamente buscar_servidor y servidores_por',
  tools.map((t) => t.name).sort().join(',') === 'buscar_servidor,servidores_por',
  tools.map((t) => t.name).join(','));
for (const t of tools) {
  revisa(`${t.name}: tiene descripción`, (t.description ?? '').length > 80);
  revisa(`${t.name}: marcada como solo lectura`, t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint === false);
  revisa(`${t.name}: tiene esquema de salida`, t.outputSchema?.type === 'object');
}
const buscar = tools.find((t) => t.name === 'buscar_servidor');
const por = tools.find((t) => t.name === 'servidores_por');
revisa('buscar_servidor: pide texto (obligatorio, de 1 a 100)',
  buscar?.inputSchema?.required?.includes('texto') &&
    buscar.inputSchema.properties.texto.minLength === 1 &&
    buscar.inputSchema.properties.texto.maxLength === 100);
revisa('servidores_por: campo es una lista cerrada con las 5 columnas del CSV',
  JSON.stringify(por?.inputSchema?.properties?.campo?.enum) ===
    JSON.stringify(['nombre', 'rol', 'sistema_operativo', 'entorno', 'responsable']));
revisa('servidores_por: pide campo y valor',
  ['campo', 'valor'].every((k) => por?.inputSchema?.required?.includes(k)));

const llama = (name, args) => cliente.callTool({ name, arguments: args });

console.log('buscar_servidor');
let r = await llama('buscar_servidor', { texto: 'postgresql' });
revisa('"postgresql" -> 2 bases de datos', r.structuredContent?.total === 2 &&
  nombres(r).join() === 'db-dev-01,db-prod-01', nombres(r).join());
r = await llama('buscar_servidor', { texto: 'PROD' });
revisa('"PROD" (mayúsculas) -> 7', r.structuredContent?.total === 7, String(r.structuredContent?.total));
r = await llama('buscar_servidor', { texto: 'Producción' });
revisa('"Producción" (con acento) -> 7', r.structuredContent?.total === 7, String(r.structuredContent?.total));
r = await llama('buscar_servidor', { texto: 'debian' });
revisa('"debian" -> 2', nombres(r).join() === 'srv-monitoreo-01,srv-web-qa-01', nombres(r).join());
r = await llama('buscar_servidor', { texto: '  equipo   datos ' });
revisa('"  equipo   datos " (espacios de más) -> 2', r.structuredContent?.total === 2, String(r.structuredContent?.total));
r = await llama('buscar_servidor', { texto: 'no-existe' });
revisa('"no-existe" -> 0 sin error', r.isError !== true && r.structuredContent?.total === 0);
revisa('el texto de la respuesta es el mismo JSON que la salida estructurada',
  JSON.stringify(JSON.parse(texto(r))) === JSON.stringify(r.structuredContent));
revisa('"" -> error de validación', (await mensajeDeError(llama('buscar_servidor', { texto: '' }))) !== null);
revisa('"   " (solo espacios) -> error de validación', (await mensajeDeError(llama('buscar_servidor', { texto: '   ' }))) !== null);
revisa('101 caracteres -> error de validación', (await mensajeDeError(llama('buscar_servidor', { texto: 'x'.repeat(101) }))) !== null);
revisa('sin argumentos -> error de validación', (await mensajeDeError(llama('buscar_servidor', {}))) !== null);

console.log('servidores_por');
r = await llama('servidores_por', { campo: 'entorno', valor: 'produccion' });
revisa('entorno=produccion -> 7', r.structuredContent?.total === 7, String(r.structuredContent?.total));
revisa('con resultados no regresa valores_disponibles', !('valores_disponibles' in (r.structuredContent ?? {})));
r = await llama('servidores_por', { campo: 'entorno', valor: 'qa' });
revisa('entorno=qa -> srv-web-qa-01', nombres(r).join() === 'srv-web-qa-01', nombres(r).join());
r = await llama('servidores_por', { campo: 'sistema_operativo', valor: 'RHEL 9.2' });
revisa('sistema_operativo=RHEL 9.2 -> 3', nombres(r).join() === 'db-prod-01,srv-app-prod-01,srv-app-prod-02', nombres(r).join());
r = await llama('servidores_por', { campo: 'sistema_operativo', valor: 'RHEL' });
revisa('sistema_operativo=RHEL (incompleto) -> 0: compara el valor completo', r.structuredContent?.total === 0);
r = await llama('servidores_por', { campo: 'responsable', valor: 'equipo datos' });
revisa('responsable=equipo datos -> 2', nombres(r).join() === 'db-dev-01,db-prod-01', nombres(r).join());
r = await llama('servidores_por', { campo: 'nombre', valor: 'SRV-AD-01' });
revisa('nombre=SRV-AD-01 -> el controlador de dominio con sus 5 campos',
  r.structuredContent?.total === 1 &&
    JSON.stringify(r.structuredContent.servidores[0]) === JSON.stringify({
      nombre: 'srv-ad-01', rol: 'controlador de dominio', sistema_operativo: 'Windows Server 2022',
      entorno: 'produccion', responsable: 'Equipo Infraestructura',
    }));
r = await llama('servidores_por', { campo: 'entorno', valor: 'staging' });
revisa('entorno=staging -> 0 con valores_disponibles = desarrollo, produccion, qa',
  r.isError !== true && r.structuredContent?.total === 0 &&
    JSON.stringify(r.structuredContent?.valores_disponibles) === JSON.stringify(['desarrollo', 'produccion', 'qa']),
  JSON.stringify(r.structuredContent));
revisa('campo=ip -> error (no es una columna)', (await mensajeDeError(llama('servidores_por', { campo: 'ip', valor: 'x' }))) !== null);
revisa('valor vacío -> error de validación', (await mensajeDeError(llama('servidores_por', { campo: 'entorno', valor: '' }))) !== null);

console.log('Otros');
revisa('herramienta inexistente -> error', (await mensajeDeError(llama('borrar_servidor', { nombre: 'srv-ad-01' }))) !== null);
await cliente.close();
revisa('el CSV real no cambió (SHA-256 igual antes y después)', sha256(CSV_REAL) === hashAntes);

// --- 3. Copia temporal del servidor con CSV de prueba -----------------------
// index.js busca el CSV en ../../docs/ respecto de sí mismo; en la copia esa carpeta es
// temporal, así que se pueden probar los errores sin tocar el inventario real.
// La copia vive dentro de esta carpeta (.prueba-*, ignorada por git): Node encuentra
// node_modules y package.json subiendo de carpeta, sin enlaces que borrar después.
console.log('Copia temporal con CSV de prueba');
const raiz = mkdtempSync(join(AQUI, '.prueba-'));
try {
  const dirServidor = join(raiz, 'herramientas', 'mcp-inventario');
  const csvPrueba = join(raiz, 'docs', 'inventario-servidores.csv');
  mkdirSync(dirServidor, { recursive: true });
  mkdirSync(dirname(csvPrueba));
  cpSync(SERVIDOR, join(dirServidor, 'index.js'));

  const encabezado = 'nombre,rol,sistema_operativo,entorno,responsable';
  // BOM, CRLF, coma dentro de comillas, comillas escapadas y línea en blanco al final.
  writeFileSync(csvPrueba,
    '﻿' + encabezado + '\r\n' +
    'srv-uno,"servidor web, Nginx",Debian 12,qa,"Equipo ""Datos"""\r\n' +
    'srv-dos,monitoreo,Debian 12,produccion,Equipo Infraestructura\r\n\r\n');
  const copia = await conecta(join(dirServidor, 'index.js'));
  const llamaCopia = (name, args) => copia.callTool({ name, arguments: args });

  r = await llamaCopia('buscar_servidor', { texto: 'web, nginx' });
  revisa('coma dentro de comillas se lee como parte del campo',
    r.structuredContent?.total === 1 && r.structuredContent.servidores[0].rol === 'servidor web, Nginx');
  r = await llamaCopia('servidores_por', { campo: 'responsable', valor: 'Equipo "Datos"' });
  revisa('comillas escapadas ("") se leen como una comilla', nombres(r).join() === 'srv-uno', nombres(r).join());
  r = await llamaCopia('servidores_por', { campo: 'nombre', valor: 'srv-dos' });
  revisa('BOM, CRLF y línea en blanco no afectan', r.structuredContent?.total === 1 &&
    r.structuredContent.servidores[0].responsable === 'Equipo Infraestructura');

  writeFileSync(csvPrueba, encabezado + '\nsrv-tres,monitoreo,Debian 12,qa,Equipo Datos\n');
  r = await llamaCopia('buscar_servidor', { texto: 'srv' });
  revisa('un cambio en el CSV se ve sin reiniciar el servidor', nombres(r).join() === 'srv-tres', nombres(r).join());

  writeFileSync(csvPrueba, 'nombre,rol,so,entorno,responsable\nsrv-uno,web,Debian 12,qa,Equipo Datos\n');
  let msg = await mensajeDeError(llamaCopia('buscar_servidor', { texto: 'srv' }));
  revisa('columnas distintas -> error que lo explica', /columnas/.test(msg ?? ''), msg ?? 'no falló');

  writeFileSync(csvPrueba, encabezado + '\nsrv-uno,web,Debian 12,qa\n');
  msg = await mensajeDeError(llamaCopia('servidores_por', { campo: 'entorno', valor: 'qa' }));
  revisa('registro con campos de menos -> error que lo explica', /registro 1/.test(msg ?? ''), msg ?? 'no falló');

  writeFileSync(csvPrueba, encabezado + '\nsrv-uno,"web,Debian 12,qa,Equipo Datos\n');
  msg = await mensajeDeError(llamaCopia('buscar_servidor', { texto: 'srv' }));
  revisa('comillas sin cerrar -> error que lo explica', /comillas sin cerrar/.test(msg ?? ''), msg ?? 'no falló');

  unlinkSync(csvPrueba);
  msg = await mensajeDeError(llamaCopia('buscar_servidor', { texto: 'srv' }));
  revisa('sin CSV -> error que lo explica (ENOENT), sin ruta absoluta',
    /No se pudo leer.*ENOENT/.test(msg ?? '') && !(msg ?? '').includes(raiz), msg ?? 'no falló');
  r = await llamaCopia('servidores_por', { campo: 'entorno', valor: 'qa' }).catch(() => null);
  revisa('el servidor sigue respondiendo después de un error', r !== null);

  await copia.close();
} finally {
  rmSync(raiz, { recursive: true, force: true });
}

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
process.exit(fallaron === 0 ? 0 : 1);
