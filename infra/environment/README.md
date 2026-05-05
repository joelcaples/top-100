# Terraform Azure Environment

This folder provisions Azure infrastructure for the app:

- Resource Group
- Linux App Service Plan + Web App (Node)
- Azure SQL Server + Database
- Storage Account + Blob Container for generated images
- App settings wired for `AZURE_SQL_CONNECTION_STRING` and Blob storage

## Prerequisites

1. Terraform >= 1.6
2. Azure CLI authenticated: `az login`
3. Correct Azure subscription selected: `az account set --subscription <subscription-id>`

## Usage

1. Copy example variables file:

```bash
cp terraform.tfvars.example terraform.tfvars
```

2. Edit `terraform.tfvars` as needed.

3. Initialise and apply:

```bash
terraform init
terraform plan
terraform apply
```

## Outputs you will use

- `app_service_name`: set this as GitHub secret `AZURE_WEBAPP_NAME`
- `sql_admin_password` (sensitive): store securely

To get publish profile for GitHub Actions secret (`AZURE_WEBAPP_PUBLISH_PROFILE`):

```bash
az webapp deployment list-publishing-profiles \
  --name <app_service_name> \
  --resource-group <resource_group_name> \
  --xml
```

## Notes

- The web app receives required app settings automatically from Terraform.
- SQL firewall rule allows Azure services (`0.0.0.0`) so App Service can connect.
- Blob container is configured with public blob access for direct image URL rendering.
