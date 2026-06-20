import frappe
from frappe import _
from frappe.utils import getdate, today, add_months, get_first_day, get_last_day


# ============================================================
# CRM DASHBOARD API v22
# ============================================================


@frappe.whitelist()
def get_dashboard_data(from_date=None, to_date=None, salesperson=None):

	from_date = from_date or frappe.utils.month_start()
	to_date = to_date or today()

	is_manager = _is_sales_manager()

	opportunities = _get_opportunities(from_date, to_date, salesperson, is_manager)
	leads = _get_leads(from_date, to_date, salesperson, is_manager)

	# All opportunities without date filter for monthly trends
	all_opportunities = _get_all_opportunities(salesperson, is_manager)
	all_leads = _get_all_leads(salesperson, is_manager)

	territories = _get_territories()
	fiscal_years = _get_fiscal_year_dates()

	return {
		"filters": {
			"from_date": from_date,
			"to_date": to_date,
			"salesperson": salesperson,
			"is_manager": is_manager,
			"current_user": frappe.session.user
		},
		"fiscal_years": fiscal_years,
		"sales_stages": _get_sales_stages(),
		"lead_statuses": _get_lead_statuses(),
		"lead_sources": _get_lead_sources(),
		"territories": territories,
		"salespersons": _get_sales_users(),
		"opportunities": opportunities,
		"leads": leads,
		"kpis": _calculate_kpis(opportunities, leads),
		"funnel": _calculate_funnel(opportunities),
		"territory_stats": _calculate_territory_stats(territories, opportunities, leads),
		"salesperson_stats": _calculate_salesperson_stats(opportunities),
		"monthly_trends": _calculate_monthly_trends(all_opportunities, all_leads),
		"source_stats": _calculate_source_stats(all_opportunities, all_leads),
	}


# ============================================================
# Permission Helpers
# ============================================================

def _is_sales_manager():
	return "Sales Manager" in frappe.get_roles() or "System Manager" in frappe.get_roles()


def _current_user():
	return frappe.session.user


# ============================================================
# Fiscal Year
# ============================================================

def _get_fiscal_year_dates():
	"""Return current and last fiscal year date ranges."""
	try:
		# Fetch the two most recent fiscal years
		fiscal_years = frappe.get_all(
			"Fiscal Year",
			fields=["name", "year_start_date", "year_end_date"],
			order_by="year_start_date desc",
			limit=3
		)

		result = {}
		today_date = getdate(today())

		# Find current FY (where today falls between start and end)
		current_fy = None
		for fy in fiscal_years:
			if getdate(fy.year_start_date) <= today_date <= getdate(fy.year_end_date):
				current_fy = fy
				break

		if not current_fy and fiscal_years:
			current_fy = fiscal_years[0]

		if current_fy:
			result["current"] = {
				"label": current_fy.name,
				"from": str(current_fy.year_start_date),
				"to": str(current_fy.year_end_date)
			}

			# Find last FY (immediately before current)
			for fy in fiscal_years:
				if getdate(fy.year_end_date) < getdate(current_fy.year_start_date):
					result["last"] = {
						"label": fy.name,
						"from": str(fy.year_start_date),
						"to": str(fy.year_end_date)
					}
					break

		return result

	except Exception:
		# Fallback: April-March fiscal year
		today_date = getdate(today())
		if today_date.month >= 4:
			fy_start = today_date.replace(month=4, day=1)
			fy_end   = today_date.replace(year=today_date.year + 1, month=3, day=31)
			last_start = fy_start.replace(year=fy_start.year - 1)
			last_end   = fy_start.replace(day=31, month=3)
		else:
			fy_start = today_date.replace(year=today_date.year - 1, month=4, day=1)
			fy_end   = today_date.replace(month=3, day=31)
			last_start = fy_start.replace(year=fy_start.year - 1)
			last_end   = fy_start.replace(day=31, month=3)

		return {
			"current": {
				"label": "Current FY",
				"from": str(fy_start),
				"to": str(fy_end)
			},
			"last": {
				"label": "Last FY",
				"from": str(last_start),
				"to": str(last_end)
			}
		}


# ============================================================
# Masters
# ============================================================

def _get_sales_stages():
	stages = frappe.get_all(
		"Sales Stage",
		fields=["name", "stage_name"],
		order_by="creation asc"
	)
	result = [{"name": r.name, "label": r.stage_name or r.name} for r in stages]
	if not any(x["label"] == "Closed Won"  for x in result): result.append({"name": "Closed Won",  "label": "Closed Won"})
	if not any(x["label"] == "Closed Lost" for x in result): result.append({"name": "Closed Lost", "label": "Closed Lost"})
	return result


def _get_lead_statuses():
	"""Fetch lead status options dynamically from Lead doctype meta."""
	try:
		meta = frappe.get_meta("Lead")
		field = meta.get_field("status")
		if field and field.options:
			return [s.strip() for s in field.options.split("\n") if s.strip()]
	except Exception:
		pass
	return ["Lead", "Open", "Replied", "Opportunity", "Quotation",
	        "Lost Quotation", "Interested", "Converted", "Do Not Contact"]


def _get_lead_sources():
	"""Fetch all Lead Source names."""
	sources = frappe.get_all("Lead Source", fields=["name"], order_by="name asc")
	return [s.name for s in sources]


def _get_territories():
	territories = frappe.get_all(
		"Territory",
		fields=["name", "territory_name", "parent_territory", "is_group"],
		order_by="lft asc"
	)
	return territories


def _get_sales_users():
	users = frappe.db.sql("""
		SELECT DISTINCT p.parent AS user, u.full_name
		FROM `tabHas Role` p
		INNER JOIN `tabUser` u ON u.name = p.parent
		WHERE p.role = 'Sales User' AND u.enabled = 1
		ORDER BY u.full_name
	""", as_dict=True)
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
			filters.append(["opportunity_owner", "=", salesperson])
	else:
		filters.append(["opportunity_owner", "=", _current_user()])

	return frappe.get_all(
		"Opportunity",
		filters=filters,
		fields=["name", "party_name", "customer_name", "sales_stage", "status",
		        "opportunity_amount", "currency", "transaction_date",
		        "expected_closing", "opportunity_owner", "territory", "custom_closing_date",
		        "source", "modified"],
		order_by="transaction_date desc",
		limit_page_length=0
	)


def _get_all_opportunities(salesperson=None, is_manager=False):
	"""Get all opportunities for trend charts (no date filter)."""
	filters = []
	if is_manager:
		if salesperson:
			filters.append(["opportunity_owner", "=", salesperson])
	else:
		filters.append(["opportunity_owner", "=", _current_user()])

	return frappe.get_all(
		"Opportunity",
		filters=filters,
		fields=["name", "sales_stage", "opportunity_amount", "transaction_date",
		        "opportunity_owner", "source", "custom_closing_date"],
		order_by="transaction_date asc",
		limit_page_length=0
	)


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
			filters.append(["lead_owner", "=", salesperson])
	else:
		filters.append(["lead_owner", "=", _current_user()])

	return frappe.get_all(
		"Lead",
		filters=filters,
		fields=["name", "lead_name", "company_name", "status", "source",
		        "territory", "lead_owner", "creation", "modified"],
		order_by="creation desc",
		limit_page_length=0
	)


def _get_all_leads(salesperson=None, is_manager=False):
	"""Get all leads for trend charts (no date filter)."""
	filters = []
	if is_manager:
		if salesperson:
			filters.append(["lead_owner", "=", salesperson])
	else:
		filters.append(["lead_owner", "=", _current_user()])

	return frappe.get_all(
		"Lead",
		filters=filters,
		fields=["name", "status", "source", "creation", "lead_owner"],
		order_by="creation asc",
		limit_page_length=0
	)


# ============================================================
# KPI Calculation
# ============================================================

def _calculate_kpis(opportunities, leads):
	pipeline, won, lost = [], [], []

	for opp in opportunities:
		stage = (opp.get("sales_stage") or "").strip()
		if stage == "Closed Won":
			won.append(opp)
		elif stage == "Closed Lost":
			lost.append(opp)
		else:
			pipeline.append(opp)

	pipeline_value = sum(float(x.get("opportunity_amount") or 0) for x in pipeline)
	won_value      = sum(float(x.get("opportunity_amount") or 0) for x in won)
	lost_value     = sum(float(x.get("opportunity_amount") or 0) for x in lost)
	closed         = len(won) + len(lost)
	conversion     = round((len(won) / closed) * 100, 1) if closed else 0
	avg_deal       = round(won_value / len(won), 2) if won else 0

	return {
		"total_leads":         len(leads),
		"total_opportunities": len(opportunities),
		"pipeline_count":      len(pipeline),
		"pipeline_value":      pipeline_value,
		"won_count":           len(won),
		"won_value":           won_value,
		"lost_count":          len(lost),
		"lost_value":          lost_value,
		"conversion":          conversion,
		"average_deal_size":   avg_deal
	}


# ============================================================
# Funnel
# ============================================================

def _calculate_funnel(opportunities):
	funnel = {}
	for opp in opportunities:
		stage = opp.get("sales_stage") or "Not Set"
		if stage not in funnel:
			funnel[stage] = {"count": 0, "value": 0}
		funnel[stage]["count"] += 1
		funnel[stage]["value"] += float(opp.get("opportunity_amount") or 0)
	return funnel


# ============================================================
# Territory Statistics
# ============================================================

def _calculate_territory_stats(territories, opportunities, leads):
	result = {}
	for t in territories:
		name = t.get("name")
		result[name] = {"territory": name, "opportunities": 0, "leads": 0,
		                "pipeline_value": 0, "won_value": 0}

	for opp in opportunities:
		territory = opp.get("territory")
		if territory not in result:
			continue
		result[territory]["opportunities"] += 1
		amount = float(opp.get("opportunity_amount") or 0)
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
			stats[owner] = {"owner": owner, "opportunities": 0, "pipeline": 0,
			                "won": 0, "lost": 0, "pipeline_value": 0, "won_value": 0}
		row    = stats[owner]
		row["opportunities"] += 1
		amount = float(opp.get("opportunity_amount") or 0)
		stage  = opp.get("sales_stage")
		if stage == "Closed Won":
			row["won"]       += 1
			row["won_value"] += amount
		elif stage == "Closed Lost":
			row["lost"] += 1
		else:
			row["pipeline"]       += 1
			row["pipeline_value"] += amount

	return list(stats.values())


# ============================================================
# Monthly Trends (last 12 months)
# ============================================================

def _calculate_monthly_trends(all_opportunities, all_leads):
	"""Calculate monthly counts and values for the last 12 months."""
	from datetime import date
	import calendar

	today_date = getdate(today())
	months = []
	for i in range(11, -1, -1):
		# Go back i months
		year  = today_date.year
		month = today_date.month - i
		while month <= 0:
			month += 12
			year  -= 1
		months.append((year, month))

	def month_key(d):
		if not d:
			return None
		try:
			dt = getdate(d)
			return (dt.year, dt.month)
		except Exception:
			return None

	# Build monthly buckets
	result = {}
	for y, m in months:
		label = date(y, m, 1).strftime("%b %Y")
		result[(y, m)] = {
			"label":      label,
			"opps":       0,
			"leads":      0,
			"won_count":  0,
			"won_value":  0
		}

	for opp in all_opportunities:
		key = month_key(opp.get("transaction_date"))
		if key in result:
			result[key]["opps"] += 1

		# Use custom_closing_date for won/lost bucketing if available
		if opp.get("sales_stage") == "Closed Won":
			closing_key = month_key(opp.get("custom_closing_date") or opp.get("transaction_date"))
			if closing_key in result:
				result[closing_key]["won_count"] += 1
				result[closing_key]["won_value"] += float(opp.get("opportunity_amount") or 0)

	for lead in all_leads:
		key = month_key(lead.get("creation"))
		if key in result:
			result[key]["leads"] += 1

	return [result[k] for k in months]


# ============================================================
# Source Statistics
# ============================================================

def _calculate_source_stats(all_opportunities, all_leads):
	"""Count leads and opportunities by source."""
	opp_sources  = {}
	lead_sources = {}

	for opp in all_opportunities:
		src = opp.get("source") or "Unknown"
		opp_sources[src] = opp_sources.get(src, 0) + 1

	for lead in all_leads:
		src = lead.get("source") or "Unknown"
		lead_sources[src] = lead_sources.get(src, 0) + 1

	# Combine all sources
	all_sources = set(list(opp_sources.keys()) + list(lead_sources.keys()))

	return [
		{
			"source":        s,
			"opportunities": opp_sources.get(s, 0),
			"leads":         lead_sources.get(s, 0)
		}
		for s in sorted(all_sources)
	]
