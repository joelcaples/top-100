# Azure App Service + Azure SQL Setup

For fully automated provisioning, use Terraform in [infra/environment](infra/environment).

Quick start:

1. `cd infra/environment`
2. `cp terraform.tfvars.example terraform.tfvars`
3. `terraform init`
4. `terraform apply`

After apply, use Terraform outputs for app name/resource group, then set GitHub Actions secrets for deployment.

This app supports two database modes:

- Local/default: SQLite at `data/listflair.sqlite`
- Azure/production: SQL Server via `AZURE_SQL_CONNECTION_STRING`

Generated image cache supports two storage modes:

- Local/default: local files under `data/generated-images`
- Azure/production: Blob Storage via `AZURE_STORAGE_CONNECTION_STRING`

## 1. Create Azure SQL resources

1. Create an Azure SQL Server.
2. Create an Azure SQL Database on that server.
3. In SQL Server networking, allow Azure services and add your client IP if needed.

## 2. Set App Service configuration

In your Azure Web App -> Settings -> Environment variables (or Configuration), add:

- `AZURE_SQL_CONNECTION_STRING`
- `AZURE_STORAGE_CONNECTION_STRING`
- `AZURE_STORAGE_CONTAINER` (optional, defaults to `generated-images`)
- `DEFAULT_AUTH_PROVIDER` (optional, defaults to `github`)

Use this format:

`Server=tcp:<server-name>.database.windows.net,1433;Database=<database-name>;User ID=<user>;Password=<password>;Encrypt=true;TrustServerCertificate=false;Connection Timeout=30;`

Also ensure:

- Runtime stack: Node 20+
- Startup command: `npm start`

## 2.1 Enable Authentication (required for per-user boards)

The app now requires sign-in for board API access in hosted environments (non-localhost). That ensures each board is scoped to the signed-in account.

In Azure Web App -> Authentication:

1. Turn on App Service authentication.
2. Add at least one identity provider (for example GitHub).
3. Set unauthenticated requests to allow anonymous to the site so users can reach the home page and click Sign In. API routes enforce auth server-side.

If you use a provider other than GitHub, set `DEFAULT_AUTH_PROVIDER` to match the Easy Auth provider key used by `/.auth/login/<provider>`.

## 3. GitHub Actions secrets

In your GitHub repo -> Settings -> Secrets and variables -> Actions, set:

- `AZURE_WEBAPP_NAME`
- `AZURE_WEBAPP_PUBLISH_PROFILE`

The workflow at `.github/workflows/deploy-azure-appservice.yml` uses these secrets.

## 4. Deploy

Push to `main` and the workflow deploys automatically.

On first run, the app auto-creates the `entries` table and missing columns in Azure SQL.

When Blob Storage settings are present, generated images are uploaded to the configured container and served from Blob URLs.

## Notes

- If Blob settings are missing, image cache falls back to local filesystem under `data/generated-images`.
- For Azure App Service production, Blob mode is recommended for durable image cache across restarts and scale-out.
