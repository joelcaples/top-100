resource "random_string" "suffix" {
  length  = 6
  lower   = true
  upper   = false
  numeric = true
  special = false
}

resource "random_password" "sql_admin_password" {
  length           = 24
  special          = true
  override_special = "!@#%^*-_=+"
}

locals {
  base_name            = lower(replace("${var.project_name}-${var.environment}", "/[^a-z0-9-]/", ""))
  sql_server_name      = substr("${replace(local.base_name, "-", "")}-sql-${random_string.suffix.result}", 0, 63)
  app_service_name     = substr("${replace(local.base_name, "-", "")}-app-${random_string.suffix.result}", 0, 60)
  app_service_plan     = substr("${replace(local.base_name, "-", "")}-plan-${random_string.suffix.result}", 0, 60)
  sql_database_name    = substr("${replace(local.base_name, "-", "")}-db", 0, 128)
  storage_account_name = substr(replace("${var.project_name}${var.environment}${random_string.suffix.result}", "/[^a-z0-9]/", ""), 0, 24)
}

resource "azurerm_resource_group" "main" {
  name     = "${local.base_name}-rg"
  location = var.location
  tags     = var.tags
}

resource "azurerm_service_plan" "main" {
  name                = local.app_service_plan
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  os_type             = "Linux"
  sku_name            = var.app_service_sku_name
  tags                = var.tags
}

resource "azurerm_storage_account" "main" {
  name                            = local.storage_account_name
  resource_group_name             = azurerm_resource_group.main.name
  location                        = azurerm_resource_group.main.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = true
  tags                            = var.tags
}

resource "azurerm_storage_container" "generated_images" {
  name                  = var.storage_container_name
  storage_account_name  = azurerm_storage_account.main.name
  container_access_type = "blob"
}

resource "azurerm_mssql_server" "main" {
  name                         = local.sql_server_name
  resource_group_name          = azurerm_resource_group.main.name
  location                     = azurerm_resource_group.main.location
  version                      = "12.0"
  administrator_login          = var.sql_admin_username
  administrator_login_password = random_password.sql_admin_password.result
  minimum_tls_version          = "1.2"
  tags                         = var.tags
}

resource "azurerm_mssql_firewall_rule" "allow_azure_services" {
  name             = "AllowAzureServices"
  server_id        = azurerm_mssql_server.main.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

resource "azurerm_mssql_database" "main" {
  name      = local.sql_database_name
  server_id = azurerm_mssql_server.main.id
  sku_name  = "Basic"
  tags      = var.tags
}

locals {
  sql_connection_string = "Server=tcp:${azurerm_mssql_server.main.fully_qualified_domain_name},1433;Database=${azurerm_mssql_database.main.name};User ID=${var.sql_admin_username};Password=${random_password.sql_admin_password.result};Encrypt=true;TrustServerCertificate=false;Connection Timeout=30;"
}

resource "azurerm_linux_web_app" "main" {
  name                = local.app_service_name
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  service_plan_id     = azurerm_service_plan.main.id
  https_only          = true
  tags                = var.tags

  site_config {
    always_on = true

    application_stack {
      node_version = var.node_version
    }
  }

  app_settings = {
    WEBSITES_PORT                  = "3000"
    AZURE_SQL_CONNECTION_STRING    = local.sql_connection_string
    AZURE_STORAGE_CONNECTION_STRING = azurerm_storage_account.main.primary_connection_string
    AZURE_STORAGE_CONTAINER        = azurerm_storage_container.generated_images.name
  }
}
