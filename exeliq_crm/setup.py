import frappe


def after_install():
	_sync_page()
	frappe.clear_cache()
	print("Exeliq CRM: Installed successfully")


def after_migrate():
	_sync_page()
	frappe.clear_cache()


def after_sync():
	_sync_page()
	frappe.clear_cache()


def _sync_page():
	"""Ensure the crm-dashboard page has correct roles in the database."""
	try:
		if not frappe.db.exists("Page", "crm-dashboard"):
			print("Exeliq CRM: Page crm-dashboard not found in DB, skipping role sync")
			return

		page = frappe.get_doc("Page", "crm-dashboard")

		# Ensure all three roles are present
		existing_roles = [r.role for r in page.roles]
		roles_to_add = ["Sales User", "Sales Manager", "System Manager"]

		changed = False
		for role in roles_to_add:
			if role not in existing_roles:
				page.append("roles", {"role": role})
				changed = True

		if changed:
			page.save(ignore_permissions=True)
			frappe.db.commit()
			print("Exeliq CRM: Page roles updated")
		else:
			print("Exeliq CRM: Page roles already correct")

	except Exception as e:
		print("Exeliq CRM: Could not sync page roles:", str(e))
