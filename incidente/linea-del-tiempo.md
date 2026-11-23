# Línea del tiempo del incidente del 21 y 22 de noviembre de 2026

Datos ficticios del curso. Fuentes:

- `incidente/auth.log`: sshd de `srv-app-prod-01`. Se cita como **L** + número de línea.
- `incidente/nginx-access.log`: log de acceso del sitio de inventario. Se cita como **W** + número de línea.

El correo `incidente/correo-sospechoso.eml` no se usó aquí.

## Desfase de reloj

**El reloj del log web va 422 s (7 min 02 s) adelantado respecto de `auth.log`.**

- **El monitor:** `10.20.0.15` deja en cada ronda un acceso SSH con llave y un `GET /salud`. Los 102 pares dan exactamente +422 s, del primero (L18 22:01:08 y W6 22:08:10) al último (L2306 06:25:08 y W1616 06:32:10).
- **Los intervalos:** los 101 intervalos entre rondas son idénticos en los dos logs, así que son los mismos eventos.
- **jlopez lo confirma:** entra por SSH a las 22:10:15 (L46). Su `GET /admin/estado` (W65, 22:17:40) cae, ya corregido, a las 22:10:38.
- **Los extremos:** con la corrección, los dos logs empiezan en el mismo minuto (L1 22:00:00 y W1 22:07:17, que da 22:00:15).

Convenciones y límites:

- **Reloj de referencia:** todas las horas de este documento van en el reloj de `auth.log`. Para el web se da también la hora original entre paréntesis.
- **Cuál reloj es el correcto:** estos logs no lo dicen. Hay que revisar la sincronización (NTP) de los equipos que escriben cada log.
- **¿Mismo equipo? Queda abierto.** Un mismo equipo comparte el reloj, así que 7 min de diferencia sugieren que `nginx-access.log` viene de otro equipo. Pero en L65 `jlopez` corre `sudo systemctl status nginx` en `srv-app-prod-01`, así que ahí también hay un nginx. Hay que confirmar de qué equipo salió el log.

## Resumen

| | |
|---|---|
| **Inicio** | 21-nov **23:37:10**: primer sondeo web de la campaña, de 203.0.113.45 (W453, 23:44:12) |
| Primer intento SSH de la campaña | 23:41:07, de 203.0.113.45 (L332) |
| **Acceso exitoso** | 22-nov **05:13:41**: `soporte` entra con contraseña desde **198.51.100.23** (L2110) |
| Después del acceso | 05:15:02: intenta `sudo /bin/bash`; se le niega porque no está en sudoers (L2130) |
| **Fin** | **05:28:10**: el intruso cierra la sesión tras 14 min 29 s (L2158-L2160) |
| IP de la campaña | 203.0.113.45, 198.51.100.23, 192.0.2.77, 203.0.113.118 |
| Duración | 5 h 51 min. 198.51.100.23 tardó 5 h 21 min y 50 fallas en entrar (L362 a L2110) |

## Línea del tiempo

| Hora (auth.log) | Evidencia | Qué pasa |
|---|---|---|
| 21-nov 22:00:00 | L1 | Empieza `auth.log`. Desde el primer minuto hay ruido de fondo: 45 IP externas con 1-3 intentos cada una, hasta las 06:10:41 (L2274). |
| 22:00:15 | W1 (22:07:17) | Empieza el log web. |
| 22:01:08 | L18, W6 (22:08:10) | Primera ronda del monitor `10.20.0.15`. Se repite cada 236-363 s toda la noche. |
| 22:02:44 | W22 (22:09:46) | Empieza el escaneo web repartido: 40 IP, 81 peticiones, todas con 404. Sigue hasta las 06:11:51 (W1489, 06:18:53). Ninguna de esas IP aparece en SSH. |
| 22:10:15-22:34:23 | L46, W65, L65, L68, L127 | `jlopez` (10.20.0.50) entra con llave, consulta `/admin/estado` y revisa nginx y la app con sudo. Es legítimo. |
| 23:02:43-23:03:25 | L226-L231 | `mgarcia` (10.20.0.61) falla 2 contraseñas y entra a la tercera. Es legítimo. |
| **23:37:10** | W453 (23:44:12) | **Inicio de la campaña.** 203.0.113.45 (`zgrab`) pide `/` y lanza 5 sondeos en 11 s: `/.aws/credentials`, `/admin/login`, `/backup.zip`, `/actuator/health` y `/.git/config` (W454-W464). |
| 23:41:07 | L332 | 203.0.113.45 empieza por SSH. |
| 23:49:01 y 23:52:40 | W505 (23:56:03), L362 | 198.51.100.23 (`python-requests`) entra por el web y luego por SSH. Su primer intento SSH ya es contra `soporte`. |
| 00:01:42 y 00:05:14 | W532 (00:08:44), L399 | 192.0.2.77 (`Go-http-client`), igual: primero el web y luego SSH. |
| 00:16:18 y 00:19:50 | W561 (00:23:20), L483 | 203.0.113.118 (`curl`), igual. |
| 00:19:50-05:15:00 | — | Los 4 atacantes siguen en paralelo. Por SSH, cada uno deja al menos 312 s entre intentos (mediana 379-420 s) y rota entre 5 y 6 usuarios. En el web, vuelven con ráfagas cortas cada 36-69 min. |
| 01:31:07-01:31:42 | L885-L952 | 192.0.2.150 prueba 12 usuarios en 35 s y no vuelve. No aparece en el web. |
| 05:02:05 | L2064 | Última de las 32 fallas contra `soporte`, contadas desde L362. |
| **05:13:41** | L2110-L2112 | **Acceso exitoso:** `soporte` entra con contraseña desde 198.51.100.23 (sesión 5225). Esa IP llevaba 50 fallas; la última, a las 05:10:40 (L2097). El acierto llegó 181 s después, más rápido que su ritmo habitual de al menos 312 s. |
| 05:13:45-05:15:00 | L2118, L2123, L2128 | Los otros tres atacantes hacen su último intento SSH y no vuelven. |
| 05:15:02 | L2130 | `soporte` intenta `sudo /bin/bash`; se le niega. |
| 05:19:53 | W1151 (05:26:55) | Último sondeo web de la campaña, de 203.0.113.118. |
| **05:28:10** | L2158-L2160 | **Fin:** el intruso cierra la sesión. |
| 06:25:09 y 06:29:15 | L2313, W1643 (06:36:17) | Terminan los logs. |

## IP y usuarios intentados

Un usuario aparece en **negritas** si existe en el servidor, es decir, si su línea dice `Failed password for <usuario>` y no `for invalid user`. La columna SSH va de la primera a la última línea de cada IP en `auth.log`, sea «Invalid user», «Failed password» o «Accepted».

| IP | Herramienta (web) | SSH | Contraseñas fallidas | Usuarios intentados (fallas) | Web |
|---|---|---|---|---|---|
| 203.0.113.45 | `zgrab` | L332-L2123 | 51 | **root** 9, admin 9, administrador 9, **soporte** 8, test 8, usuario 8 | W453-W1043, 18 líneas |
| 198.51.100.23 | `python-requests/2.32.3` | L362-L2110 | 50 | **soporte** 10, respaldos 10, admin 10, operador 10, sistemas 10 | W505-W1091, 18 líneas |
| 192.0.2.77 | `Go-http-client/1.1` | L399-L2118 | 46 | **root** 8, ubuntu 8, **postgres** 8, oracle 8, **soporte** 7, **deploy** 7 | W532-W1084, 16 líneas |
| 203.0.113.118 | `curl/8.5.0` | L483-L2128 | 43 | admin 8, test 7, guest 7, ftpuser 7, **soporte** 7, mysql 7 | W561-W1151, 18 líneas |
| 192.0.2.150 | — | L885-L952 | 12 | admin, **root**, user, test, pi, ubuntu, oracle, git, ftp, guest, support, nagios (1 c/u) | no aparece |
| Ruido SSH: 45 IP de 192.0.2/24, 198.51.100/24 y 203.0.113/24 | — | L1-L2274 | 90 | pi 10, oracle 9, user 9, test 9, git 8, ubuntu 8, guest 7, support 7, nagios 7, ftp 7, **root** 5, admin 4 | no aparece |

- **El objetivo común:** los 4 atacantes de la campaña probaron `soporte`, 32 veces en total (10 + 8 + 7 + 7).
- **El acceso:** 198.51.100.23 acertó en su 11.º intento contra esa cuenta.

## ¿Algún acceso tuvo éxito?

**Sí, uno:** `soporte` desde 198.51.100.23 a las 05:13:41 (L2110).

Los demás accesos exitosos del log son legítimos:

- **Llave:** `monitor` 102 veces desde 10.20.0.15 y `jlopez` desde 10.20.0.50 (L46).
- **Contraseña:** `mgarcia` desde la red interna (L231).

En el web ningún atacante obtuvo respuesta en una ruta sensible. Sus únicos 200 son a `/` (W453, W505, W532 y W561); todos sus sondeos dieron 404.

## Por qué el límite de intentos no lo detuvo

El ataque se diseñó para quedar por debajo de los tres límites posibles:

1. **Por conexión** (`MaxAuthTries` de sshd, 6 por defecto).
   - Cada una de las 294 conexiones fallidas probó una sola contraseña y cerró.
   - Nunca se llega al límite: hay 0 líneas «maximum authentication attempts» o «Too many authentication failures».
2. **Por IP** (tipo fail2ban).
   - El log no muestra ningún bloqueo: 0 líneas de fail2ban o «Ban».
   - Con los valores habituales (5 fallas en 10 min) tampoco habría actuado. Cada atacante dejaba al menos 312 s entre intentos (mediana de 379 a 420 s) y nunca juntó más de 2 contraseñas fallidas en 10 min.
   - 198.51.100.23 necesitó 50 fallas, pero repartidas en 5 h 21 min.
3. **Por cuenta** (`pam_faillock`).
   - No hay bloqueo de cuenta: 0 líneas de faillock.
   - Aun así, los 32 intentos contra `soporte` llegaron repartidos entre 4 IP: como máximo 3 en 15 min y 8 en una hora.

**Además, la cuenta aceptaba contraseña desde internet.** El acceso fue por contraseña. Las cuentas con acceso legítimo entran con llave, salvo `mgarcia`, que lo hace desde la red interna.

## Lo que estos logs no dicen

- **Qué hizo el intruso en 14 minutos.** `auth.log` solo registra el `sudo` fallido. Hay que revisar el historial de la cuenta, la contabilidad de procesos y los archivos modificados entre 05:13 y 05:28 en `srv-app-prod-01`.
- **Cuál de los dos relojes es el correcto.**
- **Cómo eligieron `soporte`** los cuatro atacantes. Hay una pista fuera de estos logs, que no se analizó aquí: `incidente/correo-sospechoso.eml` se presenta como `soporte@ejemplo-edf.mx` (líneas 1 y 17) y pide responder a otro dominio (línea 18).

## Qué sigue

- **Cambiar la contraseña de `soporte`** y revisar su sesión.
- **Desactivar la contraseña por SSH** (`PasswordAuthentication no`) y aplicar la propuesta de `propuestas/fail2ban.local`.
