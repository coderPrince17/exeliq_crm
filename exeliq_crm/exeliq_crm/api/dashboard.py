import frappe


@frappe.whitelist()
def test():

    return {
        "status": "success",
        "user": frappe.session.user
    }