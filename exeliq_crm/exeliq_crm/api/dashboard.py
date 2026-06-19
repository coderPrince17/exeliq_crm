import frappe
import json


@frappe.whitelist()
def get_dashboard_data(filters=None)

    if isinstance(filters, str)
        filters = json.loads(filters)

    filters = filters or {}

    from_date = filters.get(from)
    to_date = filters.get(to)
    salesperson = filters.get(salesperson)

    is_manager = (
        Sales Manager in frappe.get_roles()
        or System Manager in frappe.get_roles()
    )

    current_user = frappe.session.user

    # -------------------------
    # Opportunity Filters
    # -------------------------

    opp_filters = [
        [modified, =, from_date +  000000],
        [modified, =, to_date +  235959],
    ]

    lead_filters = [
        [modified, =, from_date +  000000],
        [modified, =, to_date +  235959],
    ]

    if not is_manager
        opp_filters.append(
            [opportunity_owner, =, current_user]
        )

        lead_filters.append(
            [lead_owner, =, current_user]
        )

    elif salesperson

        opp_filters.append(
            [opportunity_owner, =, salesperson]
        )

        lead_filters.append(
            [lead_owner, =, salesperson]
        )

    opportunities = frappe.get_all(
        Opportunity,
        filters=opp_filters,
        fields=[
            name,
            party_name,
            customer_name,
            sales_stage,
            opportunity_amount,
            opportunity_owner,
            territory,
            transaction_date,
            modified
        ],
        limit_page_length=1000
    )

    leads = frappe.get_all(
        Lead,
        filters=lead_filters,
        fields=[
            name,
            lead_name,
            company_name,
            status,
            lead_owner,
            territory,
            modified
        ],
        limit_page_length=1000
    )

    stages = frappe.get_all(
        Sales Stage,
        fields=[
            name,
            stage_name
        ],
        order_by=creation asc
    )

    users = frappe.get_all(
        Has Role,
        filters={
            roleSales User,
            parenttypeUser
        },
        fields=[parent]
    )

    return {

        opportunities opportunities,

        leads leads,

        stages stages,

        users users
    }
