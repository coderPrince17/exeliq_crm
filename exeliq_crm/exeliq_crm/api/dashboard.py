import frappe
from frappe import _
from frappe.utils import getdate, today


# ============================================================
# CRM DASHBOARD API - MODULE 1A (PART 1)
# Foundation Layer
# ============================================================


@frappe.whitelist()
def get_dashboard_data(from_date=None, to_date=None, salesperson=None):

    from_date = from_date or frappe.utils.month_start()
    to_date = to_date or today()

    is_manager = _is_sales_manager()

    opportunities = _get_opportunities(
        from_date,
        to_date,
        salesperson,
        is_manager
    )

    leads = _get_leads(
        from_date,
        to_date,
        salesperson,
        is_manager
    )

    territories = _get_territories()

    return {
        "filters": {
            "from_date": from_date,
            "to_date": to_date,
            "salesperson": salesperson,
            "is_manager": is_manager,
            "current_user": frappe.session.user
        },

        "sales_stages": _get_sales_stages(),

        "territories": territories,

        "salespersons": _get_sales_users(),

        "opportunities": opportunities,

        "leads": leads,

        "kpis": _calculate_kpis(
            opportunities,
            leads
        ),

        "funnel": _calculate_funnel(
            opportunities
        ),

        "territory_stats": _calculate_territory_stats(
            territories,
            opportunities,
            leads
        ),

        "salesperson_stats": _calculate_salesperson_stats(
            opportunities
        )
    }


# ============================================================
# Permission Helpers
# ============================================================


def _is_sales_manager():

    return (
        "Sales Manager" in frappe.get_roles()
        or
        "System Manager" in frappe.get_roles()
    )


def _current_user():

    return frappe.session.user


# ============================================================
# Masters
# ============================================================


def _get_sales_stages():

    stages = frappe.get_all(
        "Sales Stage",
        fields=[
            "name",
            "stage_name"
        ],
        order_by="creation asc"
    )

    result = []

    for row in stages:

        result.append({
            "name": row.name,
            "label": row.stage_name or row.name
        })

    if not any(x["label"] == "Closed Won" for x in result):
        result.append({
            "name": "Closed Won",
            "label": "Closed Won"
        })

    if not any(x["label"] == "Closed Lost" for x in result):
        result.append({
            "name": "Closed Lost",
            "label": "Closed Lost"
        })

    return result


def _get_territories():

    territories = frappe.get_all(
        "Territory",
        fields=[
            "name",
            "territory_name",
            "parent_territory",
            "is_group"
        ],
        order_by="lft asc"
    )

    return territories


def _get_sales_users():

    users = frappe.db.sql(
        """
        SELECT DISTINCT
            p.parent AS user,
            u.full_name
        FROM
            `tabHas Role` p
        INNER JOIN
            `tabUser` u
                ON u.name = p.parent
        WHERE
            p.role = 'Sales User'
            AND u.enabled = 1
        ORDER BY
            u.full_name
        """,
        as_dict=True
    )

    return users

    # ============================================================
# Opportunity Query
# ============================================================

def _get_opportunities(from_date, to_date, salesperson=None, is_manager=False):

    filters = [
        ["transaction_date", ">=", getdate(from_date)],
        ["transaction_date", "<=", getdate(to_date)]
    ]

    if is_manager:

        if salesperson:
            filters.append([
                "opportunity_owner",
                "=",
                salesperson
            ])

    else:

        filters.append([
            "opportunity_owner",
            "=",
            _current_user()
        ])

    opportunities = frappe.get_all(
        "Opportunity",
        filters=filters,
        fields=[
            "name",
            "party_name",
            "customer_name",
            "sales_stage",
            "status",
            "opportunity_amount",
            "currency",
            "transaction_date",
            "expected_closing",
            "opportunity_owner",
            "territory",
            "source",
            "modified"
        ],
        order_by="transaction_date desc",
        limit_page_length=0
    )

    return opportunities


# ============================================================
# Lead Query
# ============================================================

def _get_leads(from_date, to_date, salesperson=None, is_manager=False):

    filters = [
        ["creation", ">=", from_date + " 00:00:00"],
        ["creation", "<=", to_date + " 23:59:59"]
    ]

    if is_manager:

        if salesperson:
            filters.append([
                "lead_owner",
                "=",
                salesperson
            ])

    else:

        filters.append([
            "lead_owner",
            "=",
            _current_user()
        ])

    leads = frappe.get_all(
        "Lead",
        filters=filters,
        fields=[
            "name",
            "lead_name",
            "company_name",
            "status",
            "source",
            "territory",
            "lead_owner",
            "creation",
            "modified"
        ],
        order_by="creation desc",
        limit_page_length=0
    )

    return leads

# ============================================================
# KPI Calculation
# ============================================================

def _calculate_kpis(opportunities, leads):

    pipeline = []
    won = []
    lost = []

    for opp in opportunities:

        stage = (opp.get("sales_stage") or "").strip()

        if stage == "Closed Won":
            won.append(opp)

        elif stage == "Closed Lost":
            lost.append(opp)

        else:
            pipeline.append(opp)

    pipeline_value = sum(
        float(x.get("opportunity_amount") or 0)
        for x in pipeline
    )

    won_value = sum(
        float(x.get("opportunity_amount") or 0)
        for x in won
    )

    lost_value = sum(
        float(x.get("opportunity_amount") or 0)
        for x in lost
    )

    closed = len(won) + len(lost)

    conversion = round(
        (len(won) / closed) * 100,
        2
    ) if closed else 0

    avg_deal = round(
        won_value / len(won),
        2
    ) if won else 0

    return {
        "total_leads": len(leads),
        "total_opportunities": len(opportunities),
        "pipeline_count": len(pipeline),
        "pipeline_value": pipeline_value,
        "won_count": len(won),
        "won_value": won_value,
        "lost_count": len(lost),
        "lost_value": lost_value,
        "conversion": conversion,
        "average_deal_size": avg_deal
    }


# ============================================================
# Funnel
# ============================================================

def _calculate_funnel(opportunities):

    funnel = {}

    for opp in opportunities:

        stage = opp.get("sales_stage") or "Not Set"

        if stage not in funnel:

            funnel[stage] = {
                "count": 0,
                "value": 0
            }

        funnel[stage]["count"] += 1

        funnel[stage]["value"] += float(
            opp.get("opportunity_amount") or 0
        )

    return funnel


# ============================================================
# Territory Statistics
# ============================================================

def _calculate_territory_stats(
    territories,
    opportunities,
    leads
):

    result = {}

    for t in territories:

        name = t.get("name")

        result[name] = {
            "territory": name,
            "opportunities": 0,
            "leads": 0,
            "pipeline_value": 0,
            "won_value": 0
        }

    for opp in opportunities:

        territory = opp.get("territory")

        if territory not in result:
            continue

        result[territory]["opportunities"] += 1

        amount = float(
            opp.get("opportunity_amount") or 0
        )

        if opp.get("sales_stage") == "Closed Won":

            result[territory]["won_value"] += amount

        else:

            result[territory]["pipeline_value"] += amount

    for lead in leads:

        territory = lead.get("territory")

        if territory in result:

            result[territory]["leads"] += 1

    return list(result.values())


# ============================================================
# Salesperson Statistics
# ============================================================

def _calculate_salesperson_stats(opportunities):

    stats = {}

    for opp in opportunities:

        owner = opp.get("opportunity_owner")

        if not owner:
            continue

        if owner not in stats:

            stats[owner] = {
                "owner": owner,
                "opportunities": 0,
                "pipeline": 0,
                "won": 0,
                "lost": 0,
                "pipeline_value": 0,
                "won_value": 0
            }

        row = stats[owner]

        row["opportunities"] += 1

        amount = float(
            opp.get("opportunity_amount") or 0
        )

        stage = opp.get("sales_stage")

        if stage == "Closed Won":

            row["won"] += 1
            row["won_value"] += amount

        elif stage == "Closed Lost":

            row["lost"] += 1

        else:

            row["pipeline"] += 1
            row["pipeline_value"] += amount

    return list(stats.values())
# ============================================================
# Future Modules
# ============================================================

#
# Module 1B will add:
#
# _calculate_kpis()
#
# _calculate_funnel()
#
# _calculate_territory_stats()
#
# _calculate_heatmap()
#
# _calculate_salesperson_stats()
#
# and finally return
#
# {
#     filters,
#     sales_stages,
#     territories,
#     salespersons,
#     opportunities,
#     leads,
#     kpis,
#     funnel,
#     territory_stats,
#     heatmap,
#     salesperson_stats
# }
#
# ============================================================