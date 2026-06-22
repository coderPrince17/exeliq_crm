import frappe
from frappe.model.document import Document


class CRMSalesTarget(Document):

	def validate(self):
		filters = {
			"user":        self.user,
			"period_type": self.period_type,
			"fiscal_year": self.fiscal_year,
			"name":        ["!=", self.name or ""]
		}
		if self.period_type == "Monthly":
			filters["month"] = self.month
		elif self.period_type == "Quarterly":
			filters["quarter"] = self.quarter

		existing = frappe.db.exists("CRM Sales Target", filters)
		if existing:
			frappe.throw(
				f"A {self.period_type} target for {self.user} already exists for this period."
			)


def get_permission_query_conditions(user=None):
	"""Sales Users can only see their own targets."""
	if not user:
		user = frappe.session.user

	roles = frappe.get_roles(user)
	if "Sales Manager" in roles or "System Manager" in roles:
		return ""  # Managers see all

	# Sales Users see only their own
	return f"`tabCRM Sales Target`.`user` = {frappe.db.escape(user)}"
