# Sustituciones · CEIP Los Dolses

Aplicación web para que la jefatura de estudios organice las sustituciones diarias del claustro.

- **Consulta libre**: cualquiera con el enlace ve las sustituciones del día, el grupo de guardia y los avisos.
- **Edición con contraseña**: botón «Editar» (candado). Desde ahí se añaden ausencias y se arrastran los sustitutos a cada hora.
- **Ajustes** (en modo edición): personal (altas y bajas), grupos de guardia, calendario de guardias, horarios y copia de seguridad.
- **Móvil**: botón «Añadir al móvil» para crear el acceso directo en la pantalla de inicio.

## Cómo se guardan los datos

Todo está en `data/datos.json` dentro de este repositorio. La aplicación guarda los cambios directamente aquí
mediante un token de GitHub que se configura una sola vez en *Ajustes › Acceso y datos* y que queda cifrado
con la contraseña de edición en `data/config.json`.

## Nuevo curso

*Ajustes › Acceso y datos › Empezar nuevo curso* borra el calendario y las sustituciones y mantiene el personal y los grupos.
Después se dan de alta/baja las personas en *Ajustes › Personal* y se rellena el calendario de guardias.
