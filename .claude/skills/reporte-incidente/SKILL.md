---
name: reporte-incidente
description: Escribe el reporte de un incidente de seguridad para la dirección a partir de un análisis ya hecho (por omisión incidente/linea-del-tiempo.md) y de los logs que ese análisis cita. Verifica cada línea y cifra contra los logs, marca [pendiente] todo lo que la evidencia no muestra y entrega reportes/reporte-incidente-<fecha>.md más una versión HTML con el formato de los informes de auditoría de TI. Úsala cuando alguien pida "el reporte del incidente", "el informe para la dirección", "el reporte ejecutivo del ataque", "el post-mortem", "qué le mandamos a dirección" o "pasa la línea del tiempo a reporte". No la uses para analizar logs ni para armar la línea del tiempo (eso va antes), ni si nadie pidió el reporte.
argument-hint: "[análisis base; por omisión incidente/linea-del-tiempo.md]"
---

# Reporte de incidente para la dirección

Convierte un análisis técnico ya hecho en un reporte con el que la dirección pueda decidir.
Lo que la evidencia no muestra no se inventa: se marca **[pendiente]**.

Análisis base: `$ARGUMENTS`. Si está vacío, usa `incidente/linea-del-tiempo.md`. Si no
existe, detente y pídelo: esta skill no reconstruye la línea del tiempo desde los logs.

## Reglas
- Cada afirmación lleva su evidencia (`archivo:línea` o el archivo de donde sale). Sin
  evidencia, va `[pendiente]`. Casi nunca están en los logs, así que van `[pendiente]`:
  folio, autor, severidad oficial, hora de detección, hora de contención, nombres de
  responsables, fechas y estado de las acciones.
- El juicio de TI se escribe como propuesta: «Severidad: [pendiente] · propuesta de TI:
  Alta, porque …».
- Una relación no probada no se presenta como causa. Va como «Hallazgo adicional», con la
  relación marcada `[pendiente]`.
- Responsable = el equipo que da el inventario (`docs/inventario-servidores.csv`,
  `docs/servidores.md`) + «persona [pendiente]». Nunca inventes nombres ni fechas.
- Ningún valor de secretos, aunque aparezca en la evidencia (ver `CLAUDE.md`).
- El resumen y el impacto van en español llano. El detalle técnico va en tablas, con su
  evidencia.
- Si los datos son ficticios, dilo en una nota al inicio.

## Pasos
1. Lee el análisis base completo. Anota cada `archivo:línea` que cita y cada cifra
   (intentos, IP, horas, duraciones).
2. Verifica las líneas citadas una por una (`sed -n 'Np' archivo`). Recalcula las cifras
   con `grep`/`awk` sobre los logs:
   - fallos por IP;
   - fallos contra la cuenta comprometida antes del acceso;
   - todos los `Accepted`;
   - las IP de ruido.

   Si algo no coincide, el reporte usa lo que dice el log y se avisa al usuario.
3. Busca lo que el análisis no dice y que cambia el impacto o la causa:
   - Qué pasó dentro de la sesión comprometida: las líneas entre el acceso y el cierre
     (`sudo` negado, duración exacta).
   - Si algún sondeo web obtuvo algo: códigos de respuesta de las IP atacantes, y rutas
     sensibles que hayan respondido 200 a cualquier IP.
   - Disponibilidad: los chequeos de salud del monitoreo durante el incidente.
   - Qué corre en el servidor y con qué se conecta (`logs/`, `docs/servidores.md`).
   - Si el control de protección estaba **activo**, no solo mal configurado. Un atacante
     que sigue fallando después del umbral de bloqueo indica que no lo estaba: va como
     `[pendiente de confirmar]`.
   - El resto de la carpeta de evidencia (por ejemplo, un correo sospechoso) y lo que ya
     esté propuesto en `propuestas/`.
4. Escribe `reportes/reporte-incidente-<AAAA-MM-DD del incidente>.md`, con este orden:
   - **Encabezado:** Para / De / Fecha del reporte, periodo con zona horaria, Folio,
     Elaboró, Severidad (propuesta) y Estado.
   - **1. Resumen:** viñetas cortas (qué pasó, cómo, si entraron, qué no se sabe) y
     «Lo que se pide a la dirección»: autorizar la contención, asignar responsables y
     decidir con Legal si hay que notificar.
   - **2. Impacto:** tabla «Confirmado por la evidencia» (Tema | Qué se sabe | Evidencia) y
     lista «Desconocido», con `[pendiente]`.
   - **3. Línea del tiempo:**
     - un solo reloj: di cuál es la referencia y qué corrección aplicaste;
     - solo las filas clave;
     - filas `[pendiente]` para la detección y la contención;
     - un cierre «En cifras».
   - **4. Causa raíz:** numeradas, primero las directas y luego las contribuyentes. Al
     final, «Hallazgo adicional» si lo hay.
   - **5. Acciones y responsables:** tabla # | Acción | Tipo | Responsable | Fecha
     compromiso | Estado.
     - Tipos: Contención, Investigación, Corrección de fondo, Prevención y Decisión.
     - Una propuesta ya escrita lleva el estado «Propuesta, no aplicada (archivo)».
   - **6. Información pendiente:** todos los `[pendiente]` juntos, numerados.
   - **7. Evidencia:** tabla Archivo | Qué es.
5. Escribe el mismo contenido en `reportes/reporte-incidente-<fecha>.html` con
   `plantilla.html` de esta carpeta:
   - el resumen va en la caja de veredicto, con la insignia del hallazgo principal;
   - 5 tarjetas de cifras;
   - las causas en tarjetas C-1, C-2… y los hallazgos adicionales en H-1…;
   - cada `[pendiente]` con la clase `pend`.

   En el HTML el resumen no lleva número, así que todas las secciones corren uno: revisa
   cada referencia del tipo «(sección N)».
6. Revisa antes de entregar:
   - **Literalidad de la evidencia:** SPF *softfail* no es *fail*; las diferencias de hora
     se calculan, no se redondean.
   - **Visual:** genera capturas con Chrome sin pantalla (`--headless=new --screenshot`) a
     1100 px y a 520 px de ancho. Por debajo de unos 504 px, Chrome sin pantalla recorta la
     página y parece un error que no es.
   - **Impresión:** imprime a PDF (`--print-to-pdf`) y confirma que las tablas se parten
     entre filas y repiten su encabezado.
7. Abre el HTML. `reportes/` está en `.gitignore`: no hay commit que hacer, y hay que decirlo.
8. Entrega al usuario:
   - dónde quedaron los dos archivos;
   - qué se agregó que el análisis base no traía;
   - que se verificaron las líneas citadas, o cuáles no coincidieron.
