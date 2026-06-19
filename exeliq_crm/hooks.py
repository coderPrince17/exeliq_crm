from . import __version__ as app_version

app_name = "exeliq_crm"
app_title = "Exeliq CRM"
app_publisher = "Exeliq Tech Solutions"
app_description = "Exeliq CRM Pipeline Dashboard"
app_email = "info@exeliqsolutions.com"
app_license = "MIT"
app_version = app_version

# Apps
# ------------------
required_apps = ["frappe", "erpnext"]

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "exeliq_crm",
# 		"logo": "/assets/exeliq_crm/images/logo.png",
# 		"title": "Exeliq CRM",
# 		"route": "/crm-dashboard",
# 		"has_permission": "exeliq_crm.utils.has_permission",
# 	}
# ]

# Includes in <head>
# ------------------
# include_js = {"page:crm-dashboard": "public/js/crm_dashboard.js"}

# Document Events
# ---------------
# doc_events = {}

# Scheduled Tasks
# ---------------
# scheduler_events = {}

# Testing
# -------
# before_tests = "exeliq_crm.install.before_tests"
