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
		if self.period_type == "Quarterly":
			filters["quarter"] = self.quarter
		elif self.period_type == "Annual":
			pass  # one annual target per FY per user

		existing = frappe.db.exists("CRM Sales Target", filters)
		if existing:
			frappe.throw(
				f"A {self.period_type} target for {self.user} already exists "
				f"for {self.fiscal_year}"
				+ (f" {self.quarter}" if self.period_type == "Quarterly" else "") + "."
			)


def get_permission_query_conditions(user=None):
	if not user:
		user = frappe.session.user
	roles = frappe.get_roles(user)
	if "Sales Manager" in roles or "System Manager" in roles:
		return ""
	return f"`tabCRM Sales Target`.`user` = {frappe.db.escape(user)}"
