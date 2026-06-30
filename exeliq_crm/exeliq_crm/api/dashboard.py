import frappe
from frappe import _
from frappe.utils import getdate, today, nowdate
from datetime import date, timedelta
import calendar


# ============================================================
# CRM DASHBOARD API v25
# Fixes: non-admin blank page, permissions
# New: quarterly revenue, lead heatmap, monthly stage heatmap,
#      monthly lost stats, revenue contribution
# ============================================================


@frappe.whitelist()
def get_dashboard_data(from_date=None, to_date=None, salesperson=None):
	try:
		from_date = from_date or frappe.utils.month_start()
		to_date   = to_date   or today()
		is_manager = _is_sales_manager()

		opportunities     = _get_opportunities(from_date, to_date, salesperson, is_manager)
		leads             = _get_leads(from_date, to_date, salesperson, is_manager)
		all_opportunities = _get_all_opportunities(salesperson, is_manager)
		all_leads         = _get_all_leads(salesperson, is_manager)
		# Date-range only (ignore salesperson) for Lead Status + Revenue Contribution
		leads_unfiltered    = _get_leads(from_date, to_date, None, is_manager)
		all_opps_unfiltered = _get_all_opportunities(None, is_manager)
		territories       = _get_territories()
		fiscal_years      = _get_fiscal_year_dates()
		lead_statuses     = _get_lead_statuses()
		sales_stages      = _get_sales_stages()

		return {
			"filters": {
				"from_date":    from_date,
				"to_date":      to_date,
				"salesperson":  salesperson,
				"is_manager":   is_manager,
				"current_user": frappe.session.user
			},
			"fiscal_years":          fiscal_years,
			"sales_stages":          sales_stages,
			"lead_statuses":         lead_statuses,
			"lead_sources":          _get_lead_sources(),
			"territories":           territories,
			"salespersons":          _get_sales_users(),
			"opportunities":         opportunities,
			"leads":                 leads,
			"lead_status_leads":     leads_unfiltered,
			"kpis":                  _calculate_kpis(opportunities, leads, all_opportunities, from_date, to_date),
			"funnel":                _calculate_funnel(opportunities),
			"territory_stats":       _calculate_territory_stats(territories, opportunities, leads),
			"salesperson_stats":     _calculate_salesperson_stats(opportunities, all_opportunities, from_date, to_date),
			"monthly_trends":        _calculate_monthly_trends(all_opportunities, all_leads),
			"source_stats":          _calculate_source_stats(all_opportunities, all_leads),
			"quarterly_revenue":     _calculate_quarterly_revenue(all_opportunities, fiscal_years),
			"lead_heatmap":          _calculate_lead_heatmap(all_leads, lead_statuses),
			"monthly_stage_heatmap": _calculate_monthly_stage_heatmap(all_opportunities, sales_stages),
			"opp_user_month_heatmap":  _calculate_user_month_heatmap(all_opportunities, "opportunity_owner", "transaction_date"),
			"lead_user_month_heatmap": _calculate_user_month_heatmap(all_leads, "lead_owner", "creation"),
			"revenue_contribution":  _calculate_revenue_contribution(all_opps_unfiltered),
	}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "CRM Dashboard Error")
		return {"error": str(e)}


# ============================================================
# Permission Helpers
# ============================================================

def _is_sales_manager():
	roles = frappe.get_roles()
	return "Sales Manager" in roles or "System Manager" in roles


def _current_user():
	return frappe.session.user


# ============================================================
# Masters — all use ignore_permissions=True so non-admins work
# ============================================================

def _get_sales_stages():
	stages = frappe.get_all(
		"Sales Stage",
		fields=["name", "stage_name"],
		order_by="creation asc",
		ignore_permissions=True
	)
	result = [{"name": r.name, "label": r.stage_name or r.name} for r in stages]
	if not any(x["label"] == "Closed Won"  for x in result):
		result.append({"name": "Closed Won",  "label": "Closed Won"})
	if not any(x["label"] == "Closed Lost" for x in result):
		result.append({"name": "Closed Lost", "label": "Closed Lost"})
	return result


def _get_lead_statuses():
	try:
		meta  = frappe.get_meta("Lead")
		field = meta.get_field("status")
		if field and field.options:
			return [s.strip() for s in field.options.split("\n") if s.strip()]
	except Exception:
		pass
	return ["Lead","Open","Replied","Opportunity","Quotation",
	        "Lost Quotation","Interested","Converted","Do Not Contact"]


def _get_lead_sources():
	try:
		sources = frappe.get_all("Lead Source", fields=["name"],
		                         order_by="name asc", ignore_permissions=True)
		return [s.name for s in sources]
	except Exception:
		return []


def _get_territories():
	try:
		return frappe.get_all(
			"Territory",
			fields=["name", "territory_name", "parent_territory", "is_group"],
			order_by="lft asc",
			ignore_permissions=True
		)
	except Exception:
		return []


def _get_sales_users():
	"""
	Fetch all enabled users with Sales User role.
	Uses frappe.get_all with ignore_permissions so non-admins can call this.
	"""
	try:
		has_role_rows = frappe.get_all(
			"Has Role",
			filters={"role": "Sales User", "parenttype": "User"},
			fields=["parent"],
			ignore_permissions=True,
			limit_page_length=200
		)
		user_emails = list(set([r.parent for r in has_role_rows
		                        if r.parent and r.parent not in ("Administrator", "Guest")]))
		if not user_emails:
			return []

		users = frappe.get_all(
			"User",
			filters={"name": ["in", user_emails], "enabled": 1},
			fields=["name as user", "full_name"],
			order_by="full_name asc",
			ignore_permissions=True
		)
		return users
	except Exception:
		return []


def _get_fiscal_year_dates():
	try:
		fiscal_years = frappe.get_all(
			"Fiscal Year",
			fields=["name", "year_start_date", "year_end_date"],
			order_by="year_start_date desc",
			limit=3,
			ignore_permissions=True
		)
		today_date  = getdate(today())
		current_fy  = None
		for fy in fiscal_years:
			if getdate(fy.year_start_date) <= today_date <= getdate(fy.year_end_date):
				current_fy = fy
				break
		if not current_fy and fiscal_years:
			current_fy = fiscal_years[0]

		result = {}
		if current_fy:
			result["current"] = {
				"label": current_fy.name,
				"from":  str(current_fy.year_start_date),
				"to":    str(current_fy.year_end_date)
			}
			for fy in fiscal_years:
				if getdate(fy.year_end_date) < getdate(current_fy.year_start_date):
					result["last"] = {
						"label": fy.name,
						"from":  str(fy.year_start_date),
						"to":    str(fy.year_end_date)
					}
					break
		return result
	except Exception:
		today_d = getdate(today())
		if today_d.month >= 4:
			fs = today_d.replace(month=4, day=1)
			fe = today_d.replace(year=today_d.year+1, month=3, day=31)
			ls = fs.replace(year=fs.year-1)
			le = fs.replace(day=31, month=3)
		else:
			fs = today_d.replace(year=today_d.year-1, month=4, day=1)
			fe = today_d.replace(month=3, day=31)
			ls = fs.replace(year=fs.year-1)
			le = fs.replace(day=31, month=3)
		return {
			"current": {"label": "Current FY", "from": str(fs), "to": str(fe)},
			"last":    {"label": "Last FY",    "from": str(ls), "to": str(le)}
		}


# ============================================================
# Data Queries
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
		fields=["name","party_name","customer_name","sales_stage","status",
		        "opportunity_amount","currency","transaction_date",
		        "expected_closing","opportunity_owner","territory",
		        "source","custom_closing_date","modified"],
		order_by="transaction_date desc",
		limit_page_length=0,
		ignore_permissions=True
	)


def _get_all_opportunities(salesperson=None, is_manager=False):
	filters = []
	if is_manager:
		if salesperson:
			filters.append(["opportunity_owner", "=", salesperson])
	else:
		filters.append(["opportunity_owner", "=", _current_user()])

	return frappe.get_all(
		"Opportunity",
		filters=filters,
		fields=["name","sales_stage","opportunity_amount","transaction_date",
		        "opportunity_owner","source","custom_closing_date"],
		order_by="transaction_date asc",
		limit_page_length=0,
		ignore_permissions=True
	)


def _get_leads(from_date, to_date, salesperson=None, is_manager=False):
	filters = [
		["creation", ">=", from_date + " 00:00:00"],
		["creation", "<=", to_date   + " 23:59:59"]
	]
	if is_manager:
		if salesperson:
			filters.append(["lead_owner", "=", salesperson])
	else:
		filters.append(["lead_owner", "=", _current_user()])

	return frappe.get_all(
		"Lead",
		filters=filters,
		fields=["name","lead_name","company_name","status","source",
		        "territory","lead_owner","creation","modified"],
		order_by="creation desc",
		limit_page_length=0,
		ignore_permissions=True
	)


def _get_all_leads(salesperson=None, is_manager=False):
	filters = []
	if is_manager:
		if salesperson:
			filters.append(["lead_owner", "=", salesperson])
	else:
		filters.append(["lead_owner", "=", _current_user()])

	return frappe.get_all(
		"Lead",
		filters=filters,
		fields=["name","status","source","creation","lead_owner"],
		order_by="creation asc",
		limit_page_length=0,
		ignore_permissions=True
	)


# ============================================================
# KPIs
# ============================================================

def _calculate_kpis(opportunities, leads, all_opportunities, from_date, to_date):
	"""
	Pipeline metrics use opportunities created in the period (transaction_date).
	Won/Lost metrics use opportunities CLOSED in the period (custom_closing_date),
	regardless of when they were created — this is the correct business logic.
	"""
	fd = getdate(from_date)
	td = getdate(to_date)

	# Pipeline = open opportunities created in the period
	pipeline = []
	for opp in opportunities:
		stage = (opp.get("sales_stage") or "").strip()
		if stage not in ("Closed Won", "Closed Lost"):
			pipeline.append(opp)

	# Won/Lost = opportunities whose custom_closing_date falls in the period
	won, lost = [], []
	for opp in all_opportunities:
		stage = (opp.get("sales_stage") or "").strip()
		if stage not in ("Closed Won", "Closed Lost"):
			continue
		# Use custom_closing_date; fall back to transaction_date if missing
		close_raw = opp.get("custom_closing_date") or opp.get("transaction_date")
		if not close_raw:
			continue
		try:
			close_date = getdate(close_raw)
		except Exception:
			continue
		if fd <= close_date <= td:
			if stage == "Closed Won":
				won.append(opp)
			else:
				lost.append(opp)

	pipeline_value = sum(float(x.get("opportunity_amount") or 0) for x in pipeline)
	won_value      = sum(float(x.get("opportunity_amount") or 0) for x in won)
	lost_value     = sum(float(x.get("opportunity_amount") or 0) for x in lost)
	closed         = len(won) + len(lost)
	conversion     = round((len(won) / closed) * 100, 2) if closed else 0
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
# Territory Stats
# ============================================================

def _calculate_territory_stats(territories, opportunities, leads):
	result = {}
	for t in territories:
		name = t.get("name")
		result[name] = {"territory": name, "opportunities": 0, "leads": 0,
		                "pipeline_value": 0, "won_value": 0}
	for opp in opportunities:
		t = opp.get("territory")
		if t not in result: continue
		result[t]["opportunities"] += 1
		amt = float(opp.get("opportunity_amount") or 0)
		if opp.get("sales_stage") == "Closed Won":
			result[t]["won_value"] += amt
		else:
			result[t]["pipeline_value"] += amt
	for lead in leads:
		t = lead.get("territory")
		if t in result:
			result[t]["leads"] += 1
	return list(result.values())


# ============================================================
# Salesperson Stats
# ============================================================

def _calculate_salesperson_stats(opportunities, all_opportunities, from_date, to_date):
	"""
	Pipeline counts from opportunities created in period (transaction_date).
	Won/Lost counts from opportunities CLOSED in period (custom_closing_date).
	"""
	fd = getdate(from_date)
	td = getdate(to_date)
	stats = {}

	def ensure(owner):
		if owner not in stats:
			stats[owner] = {"owner": owner, "opportunities": 0, "pipeline": 0,
			                "won": 0, "lost": 0, "pipeline_value": 0, "won_value": 0}

	# Pipeline (open) opps created in the period
	for opp in opportunities:
		owner = opp.get("opportunity_owner")
		if not owner: continue
		stage = (opp.get("sales_stage") or "").strip()
		if stage in ("Closed Won", "Closed Lost"):
			continue
		ensure(owner)
		stats[owner]["opportunities"] += 1
		stats[owner]["pipeline"] += 1
		stats[owner]["pipeline_value"] += float(opp.get("opportunity_amount") or 0)

	# Won/Lost opps closed in the period (by custom_closing_date)
	for opp in all_opportunities:
		owner = opp.get("opportunity_owner")
		if not owner: continue
		stage = (opp.get("sales_stage") or "").strip()
		if stage not in ("Closed Won", "Closed Lost"):
			continue
		close_raw = opp.get("custom_closing_date") or opp.get("transaction_date")
		if not close_raw: continue
		try:
			close_date = getdate(close_raw)
		except Exception:
			continue
		if not (fd <= close_date <= td):
			continue
		ensure(owner)
		amt = float(opp.get("opportunity_amount") or 0)
		stats[owner]["opportunities"] += 1
		if stage == "Closed Won":
			stats[owner]["won"] += 1
			stats[owner]["won_value"] += amt
		else:
			stats[owner]["lost"] += 1

	return list(stats.values())


# ============================================================
# Monthly Trends — last 12 months
# ============================================================

def _calculate_monthly_trends(all_opportunities, all_leads):
	today_date = getdate(today())
	months = []
	for i in range(11, -1, -1):
		y = today_date.year
		m = today_date.month - i
		while m <= 0: m += 12; y -= 1
		months.append((y, m))

	def mk(d):
		if not d: return None
		try:
			dt = getdate(d); return (dt.year, dt.month)
		except Exception: return None

	result = {}
	for y, m in months:
		result[(y, m)] = {
			"label":      date(y, m, 1).strftime("%b %Y"),
			"opps":       0, "leads":      0,
			"won_count":  0, "won_value":  0,
			"lost_count": 0, "lost_value": 0
		}

	for opp in all_opportunities:
		key = mk(opp.get("transaction_date"))
		if key in result: result[key]["opps"] += 1

		stage = opp.get("sales_stage")
		amt   = float(opp.get("opportunity_amount") or 0)
		closing_key = mk(opp.get("custom_closing_date") or opp.get("transaction_date"))

		if stage == "Closed Won" and closing_key in result:
			result[closing_key]["won_count"]  += 1
			result[closing_key]["won_value"]  += amt
		elif stage == "Closed Lost" and closing_key in result:
			result[closing_key]["lost_count"] += 1
			result[closing_key]["lost_value"] += amt

	for lead in all_leads:
		key = mk(lead.get("creation"))
		if key in result: result[key]["leads"] += 1

	return [result[k] for k in months]


# ============================================================
# Source Stats
# ============================================================

def _calculate_source_stats(all_opportunities, all_leads):
	opp_src = {}; lead_src = {}
	for opp in all_opportunities:
		s = opp.get("source") or "Unknown"
		opp_src[s] = opp_src.get(s, 0) + 1
	for lead in all_leads:
		s = lead.get("source") or "Unknown"
		lead_src[s] = lead_src.get(s, 0) + 1
	all_src = set(list(opp_src.keys()) + list(lead_src.keys()))
	return [{"source": s, "opportunities": opp_src.get(s,0), "leads": lead_src.get(s,0)}
	        for s in sorted(all_src)]


# ============================================================
# Quarterly Revenue — current FY, fiscal quarters
# ============================================================

def _calculate_quarterly_revenue(all_opportunities, fiscal_years):
	"""
	Fiscal quarters: Q1=Apr-Jun, Q2=Jul-Sep, Q3=Oct-Dec, Q4=Jan-Mar
	Uses custom_closing_date (falls back to transaction_date).
	Shows all 4 quarters of the current FY regardless of date filter.
	"""
	fy = fiscal_years.get("current", {})
	if not fy:
		return []

	fy_start = getdate(fy.get("from"))
	fy_label = fy.get("label", "")

	# Build 4 fiscal quarters starting from FY start (Apr 1)
	quarters = []
	q_start = fy_start
	q_names = ["Q1", "Q2", "Q3", "Q4"]
	for i in range(4):
		# Each quarter = 3 months
		q_end_month = q_start.month + 2
		q_end_year  = q_start.year
		while q_end_month > 12:
			q_end_month -= 12
			q_end_year  += 1
		last_day = calendar.monthrange(q_end_year, q_end_month)[1]
		q_end = date(q_end_year, q_end_month, last_day)

		quarters.append({
			"label":     q_names[i] + " " + fy_label,
			"from":      str(q_start),
			"to":        str(q_end),
			"won_count": 0,
			"won_value": 0,
			"is_current": q_start <= getdate(today()) <= q_end
		})

		# Next quarter starts the day after this one ends
		next_start = q_end + timedelta(days=1)
		q_start = next_start

	# Bucket won opportunities into quarters
	for opp in all_opportunities:
		if opp.get("sales_stage") != "Closed Won":
			continue
		closing_raw = opp.get("custom_closing_date") or opp.get("transaction_date")
		if not closing_raw:
			continue
		try:
			closing = getdate(closing_raw)
		except Exception:
			continue
		for q in quarters:
			if getdate(q["from"]) <= closing <= getdate(q["to"]):
				q["won_count"] += 1
				q["won_value"] += float(opp.get("opportunity_amount") or 0)
				break

	return quarters


# ============================================================
# Lead Heatmap — users vs lead statuses (managers only)
# ============================================================

def _calculate_user_month_heatmap(records, owner_field, date_field):
	"""
	Generic users x months heatmap.
	Rows = users (owner_field), Columns = last 12 months (by date_field).
	Each cell = count of records created by that user in that month.
	Used for both opportunities (transaction_date) and leads (creation).
	"""
	today_date = getdate(today())
	months = []
	for i in range(11, -1, -1):
		y = today_date.year
		m = today_date.month - i
		while m <= 0:
			m += 12
			y -= 1
		months.append(date(y, m, 1).strftime("%b %Y"))

	# Build per-user month counts
	user_map = {}
	for rec in records:
		owner = rec.get(owner_field)
		if not owner:
			continue
		raw = rec.get(date_field)
		if not raw:
			continue
		try:
			d = getdate(raw)
			label = d.strftime("%b %Y")
		except Exception:
			continue
		if label not in months:
			continue
		if owner not in user_map:
			user_map[owner] = {}
		user_map[owner][label] = user_map[owner].get(label, 0) + 1

	# Convert to list of rows
	rows = []
	for owner, month_counts in user_map.items():
		row = {"owner": owner}
		total = 0
		for mlabel in months:
			c = month_counts.get(mlabel, 0)
			row[mlabel] = c
			total += c
		row["total"] = total
		rows.append(row)

	# Sort by total descending
	rows.sort(key=lambda r: r["total"], reverse=True)

	return {"months": months, "rows": rows}


def _calculate_lead_heatmap(all_leads, lead_statuses):
	"""Rows = salespersons, Columns = lead statuses."""
	result = {}
	for lead in all_leads:
		owner  = lead.get("lead_owner")
		status = lead.get("status") or "Unknown"
		if not owner: continue
		if owner not in result:
			result[owner] = {}
		result[owner][status] = result[owner].get(status, 0) + 1

	# Convert to list format
	rows = []
	for owner, status_map in result.items():
		row = {"owner": owner}
		for s in lead_statuses:
			row[s] = status_map.get(s, 0)
		row["total"] = sum(status_map.values())
		rows.append(row)

	return rows


# ============================================================
# Monthly Stage Heatmap — months vs stages (Sales Users)
# ============================================================

def _calculate_monthly_stage_heatmap(all_opportunities, sales_stages):
	"""
	For Sales Users: rows = stages, columns = last 12 months.
	Each cell = count of opportunities in that stage created in that month.
	"""
	today_date = getdate(today())
	months = []
	for i in range(11, -1, -1):
		y = today_date.year
		m = today_date.month - i
		while m <= 0: m += 12; y -= 1
		months.append((y, m, date(y, m, 1).strftime("%b %Y")))

	stage_labels = [s["label"] for s in sales_stages]

	# Build matrix: stage → month → {count, value}
	matrix = {}
	for s in stage_labels:
		matrix[s] = {}
		for y, m, label in months:
			matrix[s][label] = {"count": 0, "value": 0}

	for opp in all_opportunities:
		stage = opp.get("sales_stage")
		if not stage or stage not in matrix: continue
		try:
			td = getdate(opp.get("transaction_date"))
			label = td.strftime("%b %Y")
		except Exception:
			continue
		if label in matrix[stage]:
			matrix[stage][label]["count"] += 1
			matrix[stage][label]["value"] += float(opp.get("opportunity_amount") or 0)

	return {
		"months": [m[2] for m in months],
		"stages": stage_labels,
		"matrix": matrix
	}


# ============================================================
# Revenue Contribution — won value by salesperson
# ============================================================

def _calculate_revenue_contribution(all_opportunities):
	"""Won value per salesperson for donut chart."""
	contrib = {}
	for opp in all_opportunities:
		if opp.get("sales_stage") != "Closed Won": continue
		owner = opp.get("opportunity_owner")
		if not owner: continue
		amt = float(opp.get("opportunity_amount") or 0)
		contrib[owner] = contrib.get(owner, 0) + amt
	return [{"owner": k, "won_value": v} for k, v in contrib.items() if v > 0]

