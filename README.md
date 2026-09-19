# Barshi Turnos

Sistema de reservas online de **Barshi Barber**.

## Publicación
La versión pública se despliega desde GitHub en Vercel.

Sitio de producción previsto:
- `https://barshi-turnos.vercel.app`

## Estado actual
El proyecto ya incluye:

- reserva online por servicio y profesional;
- agenda visual con disponibilidad;
- cálculo de disponibilidad según duración del servicio;
- margen interno entre turnos;
- panel administrativo responsive;
- administración de servicios;
- administración de profesionales;
- agenda de turnos;
- horarios semanales;
- cierres y bloqueos especiales;
- datos del negocio;
- cambio de logo y dirección;
- configuración de WhatsApp;
- login administrativo preparado;
- estructura segura de Supabase con RLS;
- prevención de dobles reservas desde base de datos.

## Falta conectar Supabase
`config.js` ya existe. **No hay que copiar ni crear otro archivo.**

Solo faltan estos pasos:

1. Crear un proyecto nuevo en Supabase.
2. Abrir **SQL Editor**.
3. Copiar todo el contenido de `supabase/schema.sql`.
4. Ejecutarlo completo.
5. Ir a **Authentication > Users** y crear el usuario administrador de Barshi.
6. Copiar el UUID de ese usuario.
7. Volver a **SQL Editor** y ejecutar:

```sql
insert into public.admin_users(user_id)
values ('PEGAR_UUID_DEL_USUARIO_AQUI');
```

8. Ir a **Project Settings > Data API** y copiar:
   - Project URL
   - Publishable key
9. Completar esos dos datos en `config.js`.

> La Project URL y la publishable key pueden estar en el frontend porque la seguridad real está configurada mediante RLS.  
> **Nunca usar ni publicar la service_role key.**

## Tablas principales
- `services`
- `professionals`
- `professional_services`
- `clients`
- `appointments`
- `settings`
- `business_hours`
- `schedule_blocks`
- `admin_users`

## Administración
Una vez conectado Supabase, el botón **Acceso Barshi** pedirá email y contraseña.

El administrador podrá gestionar:

- turnos;
- servicios;
- profesionales;
- horarios de atención;
- días cerrados;
- bloqueos por horario o profesional;
- dirección;
- ciudad;
- logo;
- WhatsApp;
- anticipación mínima de reserva;
- cantidad de días disponibles hacia adelante.

## WhatsApp
La interfaz ya contempla confirmación y recordatorios.

Para el envío automático real todavía falta conectar **WhatsApp Business / Cloud API**.
