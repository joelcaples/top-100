variable "project_name" {
  description = "Base project name used for Azure resources."
  type        = string
  default     = "listflair"
}

variable "environment" {
  description = "Deployment environment name."
  type        = string
  default     = "prd"
}

variable "location" {
  description = "Azure region."
  type        = string
  default     = "centralus"
}

variable "app_service_sku_name" {
  description = "App Service Plan SKU."
  type        = string
  default     = "B1"
}

variable "node_version" {
  description = "Node version for Linux Web App runtime stack."
  type        = string
  default     = "20-lts"
}

variable "sql_admin_username" {
  description = "Azure SQL Server admin username."
  type        = string
  default     = "sqladminuser"
}

variable "storage_container_name" {
  description = "Blob container used for generated image cache."
  type        = string
  default     = "generated-images"
}

variable "tags" {
  description = "Tags applied to all resources."
  type        = map(string)
  default = {
    managed_by = "terraform"
    app        = "listflair"
  }
}

variable "github_client_id" {
  description = "GitHub OAuth app client ID for Easy Auth."
  type        = string
}

variable "github_client_secret" {
  description = "GitHub OAuth app client secret for Easy Auth."
  type        = string
}
