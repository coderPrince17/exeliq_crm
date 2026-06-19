import frappe
from frappe.modules.utils import sync_customizations


def after_install():
	# Sync all doctypes and pages from this app
	from frappe.model.sync import sync_for
	sync_for("exeliq_crm", force=True, reset_permissions=True)
	frappe.clear_cache()
	print("Exeliq CRM: Page synced and cache cleared.")
