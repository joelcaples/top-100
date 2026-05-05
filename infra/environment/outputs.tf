output "resource_group_name" {
  value       = azurerm_resource_group.main.name
  description = "Resource group name."
}

output "app_service_name" {
  value       = azurerm_linux_web_app.main.name
  description = "Linux Web App name for GitHub deploy workflow."
}

output "app_service_default_hostname" {
  value       = azurerm_linux_web_app.main.default_hostname
  description = "Default hostname for the deployed web app."
}

output "sql_server_fqdn" {
  value       = azurerm_mssql_server.main.fully_qualified_domain_name
  description = "Azure SQL Server FQDN."
}

output "sql_database_name" {
  value       = azurerm_mssql_database.main.name
  description = "Azure SQL Database name."
}

output "storage_account_name" {
  value       = azurerm_storage_account.main.name
  description = "Storage account used for generated images."
}

output "storage_container_name" {
  value       = azurerm_storage_container.generated_images.name
  description = "Blob container storing generated images."
}

output "sql_admin_password" {
  value       = random_password.sql_admin_password.result
  sensitive   = true
  description = "Generated SQL admin password. Store this securely."
}
