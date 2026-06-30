from . import __version__ as app_version

app_name = "exeliq_crm"
app_title = "Exeliq CRM"
app_publisher = "Exeliq Tech Solutions"
app_description = "Exeliq CRM Pipeline Dashboard"
app_email = "info@exeliqsolutions.com"
app_license = "MIT"
app_version = app_version

required_apps = ["frappe", "erpnext"]

after_install = "exeliq_crm.setup.after_install"
after_sync    = "exeliq_crm.setup.after_install"
after_migrate = "exeliq_crm.setup.after_install"

# Load dashboard JS on every desk page
