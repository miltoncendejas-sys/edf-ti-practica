# Diagnóstico de los servicios

Servicios del laboratorio de la Sesión 3 (`docker-compose.yml`, datos ficticios). Todos los
comandos se corren desde la raíz del repositorio. En Claude Code, `Bash(docker *)` está en
`ask`: cada comando de Docker pide permiso.

## Servicios y puertos

| Servicio | Imagen | Puerto en tu equipo | Puerto en el contenedor | Qué es | Cómo saber si está sano |
|----------|--------|---------------------|-------------------------|--------|-------------------------|
| `web` | `nginx:1.30.5` | 8080 | 80 | Sitio interno de inventario. `/salud` responde `ok`. | Tiene healthcheck: `curl` a `/salud` cada 10 s; tras 3 fallas seguidas queda `unhealthy`. |
| `db` | `postgres:17.11` | 5433 | 5432 | Base `inventario`, con las tablas `servidores` y `respaldos`. | No tiene healthcheck. Usa `pg_isready` (abajo). |

- **Volumen:** los datos de la base viven en el volumen `datos-db`. Los scripts de `servicios/db/` solo corren la primera vez, cuando se crea el volumen.
- **Puertos expuestos:** `"8080:80"` equivale a `0.0.0.0:8080`, así que otros equipos de la red pueden llegar a los dos puertos. Para limitarlos a tu equipo se escribiría `"127.0.0.1:8080:80"`.
- **Contraseña:** por el puerto 5433 la base pide contraseña (`scram-sha-256`).
- **«Up» no basta:** si nginx arranca con una configuración que no escucha en el puerto 80, `docker compose ps` dice `Up`, pero el sitio no responde. Por eso el web tiene healthcheck. Docker Compose solo lo marca como `unhealthy`; no lo reinicia.

## Dónde están los logs

| Qué | Dónde | Cómo verlo |
|-----|-------|------------|
| nginx: accesos y errores | No hay archivo: dentro del contenedor, `/var/log/nginx/access.log` apunta a la salida estándar y `error.log`, a la salida de errores. | `docker compose logs --tail 50 web` |
| PostgreSQL | Salida estándar del contenedor. | `docker compose logs --tail 50 db` |
| Healthcheck del web | Estado del contenedor. | `docker inspect -f '{{json .State.Health}}' edf-ti-practica-web-1` |
| Incidente del 21-22 de noviembre | `incidente/auth.log` e `incidente/nginx-access.log`. Son históricos y no cambian. El reloj del log web va 422 s adelantado. | `incidente/linea-del-tiempo.md` |
| Práctica de los scripts | `logs/` (`accesos.log`, `aplicacion.log`, `respaldos.log`). | No son de los servicios de Docker. |

Con `docker compose logs` también sirven `-f` (seguir en vivo) y `--since 10m`.

Los nombres `edf-ti-practica-web-1` y `edf-ti-practica-db-1` salen del nombre de la carpeta
del repositorio. Si tu carpeta se llama distinto, `docker compose ps` muestra los tuyos.

## Comandos seguros (solo leen)

```bash
docker compose ps                                   # estado; busca "(healthy)", no solo "Up"
docker compose logs --tail 50 web                   # últimas líneas de nginx
docker compose logs --tail 50 db                    # últimas líneas de PostgreSQL
docker inspect -f '{{.State.Health.Status}} racha={{.State.Health.FailingStreak}}' edf-ti-practica-web-1
curl -I http://localhost:8080                       # cabeceras del sitio
curl -s http://localhost:8080/salud                 # debe responder "ok"
docker compose exec web nginx -t                    # valida la configuración de nginx
docker compose run --rm --no-deps web nginx -t      # lo mismo cuando el web no arranca
docker compose exec db pg_isready -U lector -d inventario
```

**Ejemplo de diagnóstico: el web se reinicia en bucle.**

1. `docker compose ps` muestra `Restarting`.
2. `docker compose logs --tail 15 web` dice qué directiva falla y en qué línea. Por ejemplo, `"client_max_body_size" directive invalid value in /etc/nginx/conf.d/default.conf:7` sale de escribir `10mb` en lugar de `10m`.
3. Corrige el archivo y valídalo con `docker compose run --rm --no-deps web nginx -t`. Usa `run` porque `exec` no funciona con un contenedor que no está arriba.
4. Recrea el servicio con `docker compose up -d --force-recreate web`.

## Comandos prohibidos y por qué

**Bloqueados en `.claude/settings.json`** (`deny`):

| Comando | Por qué |
|---------|---------|
| `docker compose down -v` | `-v` borra el volumen `datos-db`: se pierde la base. Para detener sin perder datos, usa `docker compose stop` o `down` sin `-v`. |
| `docker volume rm …` | El mismo efecto, volumen por volumen. |
| `docker system prune …` | Borra contenedores detenidos, redes, imágenes sin uso y caché de **todos** los proyectos del equipo, no solo de este. |
| `sudo …` | Cambia la máquina, no el laboratorio. Diagnosticar no requiere root. |
| `iptables …`, `ufw …` | Cambian el firewall del equipo: pueden cortar el acceso, incluido el tuyo. Docker además administra sus propias reglas. |
| `rm -rf …` | Borra sin vuelta atrás. |
| Leer `.env`, `.env.*`, `llaves/` o `~/.ssh/`; `cat .env*` | Contienen contraseñas y llaves. |

Las reglas comparan el texto del comando. `docker compose down --volumes`, `down` con el `-v`
en otra posición (por ejemplo, `down --remove-orphans -v`) y `docker volume prune` borran lo
mismo y **no** están bloqueados. Tampoco se usan.

**No están bloqueados, pero no se usan.** Unos muestran secretos y otro se salta el usuario de solo lectura:

| Comando | Por qué |
|---------|---------|
| `docker compose config` | Imprime el compose con las variables ya sustituidas: muestra `POSTGRES_PASSWORD` y `LECTOR_PASSWORD`. |
| `docker inspect edf-ti-practica-db-1` sin `-f`, o `docker compose exec db env` | Muestran las variables de entorno del contenedor, contraseñas incluidas. Con `-f` y un campo concreto, como el de salud, sí es seguro. |
| `docker compose exec db psql -U postgres` | Dentro del contenedor, las conexiones locales no piden contraseña (`trust` en `pg_hba.conf`). Entrarías como superusuario, con permiso de escribir y borrar. Usa `lector`. |

## Conectarse a la base como `lector`

`lector` solo tiene permiso de `SELECT`, y sus sesiones son de solo lectura
(`default_transaction_read_only = on`; ver `servicios/db/03-lector.sql`).

**Dentro del contenedor.** Entra por el socket local, sin contraseña:

```bash
docker compose exec db psql -U lector -d inventario
docker compose exec -T db psql -U lector -d inventario -c '\dt'    # un comando suelto
```

- **Comprobar la sesión:** `SELECT current_user, current_setting('transaction_read_only');` debe dar `lector | on`.
- **Exportar un resultado:** `\copy (SELECT …) TO 'reportes/archivo.csv' CSV HEADER` lo deja en `./reportes/`, porque `psql` corre en `/trabajo` dentro del contenedor.

**Desde Claude Code, con el MCP `inventario`.**

- **Qué es:** el servidor está en `.mcp.json` (Toolbox for Databases 1.16.0, `--prebuilt postgres`). Usa `lector` por el puerto 5433 y toma la contraseña de la variable `LECTOR_PASSWORD`. El archivo solo guarda `${LECTOR_PASSWORD}`, nunca el valor.
- **Cargar la variable:** lo corres tú, no Claude, porque `CLAUDE.md` le prohíbe leer `.env`. Hazlo en la terminal donde vas a abrir `claude`. La contraseña no se imprime.
  - En Git Bash, macOS o Linux:
    `export LECTOR_PASSWORD="$(grep '^LECTOR_PASSWORD=' .env | cut -d= -f2- | tr -d '\r')"`
  - En PowerShell:
    `$env:LECTOR_PASSWORD = ((Select-String -Path .env -Pattern '^LECTOR_PASSWORD=').Line -split '=', 2)[1].Trim()`
- **Aprobar el servidor:** la primera vez que abres `claude` en el repo te pide aprobarlo. `/mcp` muestra si quedó conectado. Herramientas útiles: `list_tables` y `execute_sql`.
- **Windows:** se probó en Windows nativo (Claude Code 2.1.330). El servidor arranca con `npx`, sin `cmd /c`.

**Cuidado con los datos de `respaldos`:**

- `servidor` es texto, sin llave foránea: hay respaldos de `srv-app-prod-03` y `srv-ftp-01`, que no están en `servidores`.
- `servicios/db/02-datos.sql` calcula las fechas a partir del día en que se crea la base (`current_date`). Por eso las fechas y los conteos cambian según ese día.
- Hay 2 respaldos con fecha futura, 30 y 400 días después de la creación: filtra con `fecha <= now()`.
- Hay unos 500 respaldos fallidos y 2 sin estado: para «tiene respaldo», cuenta solo `estado = 'exitoso'`.

## Windows sin Docker Desktop

Si Docker solo está instalado dentro de WSL, tienes dos opciones:

- **Desde la terminal de Ubuntu:** corre los comandos en la carpeta del repo, bajo `/mnt/c/…`.
- **Desde Windows:** usa `wsl --cd <ruta del repo en /mnt/c> --exec docker compose …`. Con `--exec` el comando no pasa por bash, que si no reinterpreta las comillas y las variables como `$PGDATA`.
