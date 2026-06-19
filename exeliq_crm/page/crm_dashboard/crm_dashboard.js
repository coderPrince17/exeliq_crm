// Exeliq CRM Dashboard
// Page: crm-dashboard

(function loadChartJS(callback) {
	if (window.Chart) { callback(); return; }
	var s = document.createElement('script');
	s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
	s.onload = callback;
	s.onerror = function() {
		console.error('Failed to load Chart.js');
		callback();
	};
	document.head.appendChild(s);
})(function () {

frappe.pages['crm-dashboard'].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'CRM Dashboard',
		single_column: true
	});
	frappe.crm_dashboard = new CRMDashboard(page);
};

frappe.pages['crm-dashboard'].on_page_show = function (wrapper) {
	if (frappe.crm_dashboard) {
		frappe.crm_dashboard.load_data();
	}
};

class CRMDashboard {
	constructor(page) {
		this.page = page;
		this.is_manager = frappe.user.has_role('Sales Manager') || frappe.user.has_role('System Manager');
		this.current_user = frappe.session.user;
		this.metric = 'count';
		this.charts = {};
		this.opps = [];
		this.leads = [];
		this.setup_filters();
		this.setup_html();
		this.load_data();
	}

	setup_filters() {
		this.date_from = this.page.add_field({
			fieldtype: 'Date',
			fieldname: 'date_from',
			label: 'From',
			default: frappe.datetime.month_start(),
			change: () => this.load_data()
		});

		this.date_to = this.page.add_field({
			fieldtype: 'Date',
			fieldname: 'date_to',
			label: 'To',
			default: frappe.datetime.now_date(),
			change: () => this.load_data()
		});

		this.period = this.page.add_field({
			fieldtype: 'Select',
			fieldname: 'period',
			label: 'Quick range',
			options: ['This Month', 'This Week', 'Today', 'This Quarter', 'This Year', 'Custom'],
			default: 'This Month',
			change: () => {
				var p = this.period.get_value();
				if (p !== 'Custom') {
					this.date_from.set_value(this.get_period_start(p));
					this.date_to.set_value(frappe.datetime.now_date());
					this.load_data();
				}
			}
		});

		if (this.is_manager) {
			this.sp_filter = this.page.add_field({
				fieldtype: 'Link',
				fieldname: 'salesperson',
				label: 'Salesperson',
				options: 'User',
				change: () => this.load_data()
			});
		}

		this.page.add_inner_button(__('Refresh'), () => this.load_data());
	}

	get_period_start(p) {
		if (p === 'Today') return frappe.datetime.now_date();
		if (p === 'This Week') return frappe.datetime.week_start();
		if (p === 'This Month') return frappe.datetime.month_start();
		if (p === 'This Quarter') return frappe.datetime.quarter_start();
		if (p === 'This Year') return frappe.datetime.year_start();
		return frappe.datetime.month_start();
	}

	setup_html() {
		this.page.main.html(`
<style>
.crm-dash{padding:16px}
.crm-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:20px}
.crm-metric{background:var(--fg-color);border:1px solid var(--border-color);border-radius:8px;padding:14px 16px;cursor:default}
.crm-metric-label{font-size:11px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em}
.crm-metric-val{font-size:22px;font-weight:600;color:var(--text-color)}
.crm-metric-sub{font-size:11px;color:var(--text-muted);margin-top:4px}
.crm-metric-val.green{color:var(--green)}.crm-metric-val.red{color:var(--red)}.crm-metric-val.orange{color:var(--orange)}
.crm-section-title{font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px}
.crm-card{background:var(--fg-color);border:1px solid var(--border-color);border-radius:8px;padding:16px;margin-bottom:16px}
.crm-two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
@media(max-width:768px){.crm-two-col{grid-template-columns:1fr}}
.crm-pipeline{display:flex;gap:6px;overflow-x:auto;padding-bottom:6px}
.crm-stage{flex:0 0 auto;min-width:110px;background:var(--fg-color);border:1px solid var(--border-color);border-radius:8px;padding:12px;border-top:3px solid var(--blue)}
.crm-stage-name{font-size:10px;color:var(--text-muted);margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100px}
.crm-stage-count{font-size:20px;font-weight:600}.crm-stage-val{font-size:10px;color:var(--text-muted);margin-top:3px}
.crm-hm-wrap{overflow-x:auto}
.crm-hm-table{width:100%;border-collapse:separate;border-spacing:3px;min-width:700px}
.crm-hm-table th{font-size:10px;color:var(--text-muted);padding:4px 6px;text-align:center;font-weight:500;white-space:nowrap}
.crm-hm-table th.row-h{text-align:left;min-width:130px;padding-left:4px}
.crm-hm-cell{border-radius:5px;padding:8px 4px;text-align:center;transition:opacity .1s}
.crm-hm-cell:hover{opacity:.8}
.crm-hm-cell .cv{font-size:13px;font-weight:600}
.crm-hm-cell .cs{font-size:10px;margin-top:2px;opacity:.85}
.crm-toggle-row{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}
.crm-toggle{font-size:12px;padding:4px 12px;border-radius:4px;border:1px solid var(--border-color);background:var(--fg-color);color:var(--text-muted);cursor:pointer}
.crm-toggle.active{background:var(--blue-tint);color:var(--blue);border-color:var(--blue)}
.crm-legend{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:11px;color:var(--text-muted)}
.crm-legend-strip{display:flex;height:8px;width:120px;border-radius:3px;overflow:hidden}
.crm-sp-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.crm-sp-info{display:flex;align-items:center;gap:10px}
.crm-avatar{width:32px;height:32px;border-radius:50%;background:var(--blue-tint);color:var(--blue);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;flex-shrink:0}
.crm-progress{height:5px;background:var(--border-color);border-radius:3px;margin-top:5px}
.crm-progress-fill{height:100%;border-radius:3px;transition:width .3s}
.crm-table{width:100%;border-collapse:collapse;font-size:13px}
.crm-table th{text-align:left;font-size:11px;color:var(--text-muted);padding:6px 8px;border-bottom:1px solid var(--border-color);font-weight:500;white-space:nowrap}
.crm-table td{padding:8px;border-bottom:1px solid var(--border-color);color:var(--text-color)}
.crm-table tr:last-child td{border-bottom:none}
.crm-table tr:hover td{background:var(--bg-color)}
.crm-badge{display:inline-block;font-size:11px;padding:2px 8px;border-radius:4px;font-weight:500}
.crm-badge.won{background:var(--green-tint);color:var(--green)}
.crm-badge.lost{background:var(--red-tint);color:var(--red)}
.crm-badge.open{background:var(--blue-tint);color:var(--blue)}
.crm-badge.hold{background:var(--yellow-tint);color:var(--yellow)}
.crm-loading{text-align:center;padding:40px;color:var(--text-muted);font-size:13px}
.crm-row-total{font-size:12px;font-weight:600;padding:4px 8px;text-align:center;color:var(--text-muted);white-space:nowrap}
.crm-col-total{font-size:11px;font-weight:500;padding:4px 6px;text-align:center;color:var(--text-muted)}
.crm-empty{text-align:center;padding:30px;color:var(--text-muted);font-size:13px}
</style>

<div class="crm-dash">
	<div id="crm-metrics" class="crm-metrics">
		<div class="crm-loading"><i class="fa fa-spinner fa-spin"></i> Loading...</div>
	</div>

	<div class="crm-card">
		<div class="crm-section-title">Pipeline by stage</div>
		<div id="crm-pipeline" class="crm-pipeline"></div>
	</div>

	<div class="crm-two-col">
		<div class="crm-card">
			<div class="crm-section-title">Stage breakdown</div>
			<div style="position:relative;height:220px">
				<canvas id="crm-stage-chart" role="img" aria-label="Bar chart of opportunities by stage">Opportunities by pipeline stage.</canvas>
			</div>
		</div>
		<div class="crm-card">
			<div class="crm-section-title">Lead status distribution</div>
			<div style="position:relative;height:220px">
				<canvas id="crm-lead-chart" role="img" aria-label="Doughnut chart of lead status">Lead status breakdown.</canvas>
			</div>
		</div>
	</div>

	<div class="crm-card">
		<div class="crm-section-title">Pipeline heatmap — users vs stages</div>
		<div class="crm-toggle-row">
			<button class="crm-toggle active" onclick="frappe.crm_dashboard.set_metric('count',this)">Deal count</button>
			<button class="crm-toggle" onclick="frappe.crm_dashboard.set_metric('value',this)">Deal value (₹)</button>
			<button class="crm-toggle" onclick="frappe.crm_dashboard.set_metric('both',this)">Both</button>
		</div>
		<div class="crm-hm-wrap">
			<div id="crm-heatmap"></div>
		</div>
		<div class="crm-legend">
			<span>Low</span>
			<div class="crm-legend-strip" id="crm-legend-strip"></div>
			<span>High</span>
		</div>
	</div>

	<div class="crm-two-col">
		<div class="crm-card">
			<div class="crm-section-title">Salesperson performance</div>
			<div id="crm-sp-perf"></div>
		</div>
		<div class="crm-card">
			<div class="crm-section-title">Recent opportunities</div>
			<div style="overflow-x:auto">
				<table class="crm-table">
					<thead>
						<tr>
							<th>Party</th>
							<th>Stage</th>
							<th>Owner</th>
							<th>Amount</th>
							<th>Status</th>
						</tr>
					</thead>
					<tbody id="crm-recent"></tbody>
				</table>
			</div>
		</div>
	</div>
</div>`);
	}

	get_filters() {
		return {
			from: this.date_from.get_value() || frappe.datetime.month_start(),
			to: this.date_to.get_value() || frappe.datetime.now_date(),
			sp: this.is_manager && this.sp_filter ? this.sp_filter.get_value() : null
		};
	}

	load_data() {
		var f = this.get_filters();
		var me = this;

		['crm-stage-chart', 'crm-lead-chart'].forEach(id => {
			if (me.charts[id]) {
				me.charts[id].destroy();
				delete me.charts[id];
			}
		});

		document.getElementById('crm-metrics').innerHTML =
			'<div class="crm-loading"><i class="fa fa-spinner fa-spin"></i> Loading...</div>';

		var opp_filters = [
			['transaction_date', '>=', f.from],
			['transaction_date', '<=', f.to]
		];
		var lead_filters = [
			['creation', '>=', f.from],
			['creation', '<=', f.to + ' 23:59:59']
		];

		if (!me.is_manager) {
			opp_filters.push(['opportunity_owner', '=', me.current_user]);
			lead_filters.push(['lead_owner', '=', me.current_user]);
		} else if (f.sp) {
			opp_filters.push(['opportunity_owner', '=', f.sp]);
			lead_filters.push(['lead_owner', '=', f.sp]);
		}

		Promise.all([
			frappe.call({
				method: 'frappe.client.get_list',
				args: {
					doctype: 'Opportunity',
					filters: opp_filters,
					fields: [
						'name', 'party_name', 'customer_name', 'sales_stage',
						'status', 'opportunity_amount', 'opportunity_owner',
						'transaction_date', 'probability', 'expected_closing'
					],
					limit_page_length: 500,
					order_by: 'transaction_date desc'
				}
			}),
			frappe.call({
				method: 'frappe.client.get_list',
				args: {
					doctype: 'Lead',
					filters: lead_filters,
					fields: [
						'name', 'lead_name', 'company_name', 'status',
						'lead_owner', 'creation', 'annual_revenue'
					],
					limit_page_length: 500
				}
			})
		]).then(([opp_res, lead_res]) => {
			me.opps = opp_res.message || [];
			me.leads = lead_res.message || [];
			me.render_all();
		}).catch(err => {
			document.getElementById('crm-metrics').innerHTML =
				'<div class="crm-loading" style="color:var(--red)">Error loading data. Check browser console for details.</div>';
			console.error('CRM Dashboard error:', err);
		});
	}

	render_all() {
		this.render_metrics();
		this.render_pipeline();
		this.render_stage_chart();
		this.render_lead_chart();
		this.render_heatmap();
		this.render_sp_performance();
		this.render_recent();
	}

	fmt(val) {
		if (!val) return '₹0';
		if (val >= 10000000) return '₹' + (val / 10000000).toFixed(1) + ' Cr';
		if (val >= 100000) return '₹' + (val / 100000).toFixed(1) + 'L';
		if (val >= 1000) return '₹' + (val / 1000).toFixed(1) + 'K';
		return '₹' + Math.round(val);
	}

	get_stages() {
		return [
			'Qualification', 'Needs Analysis', 'Value Proposition',
			'Perception Analysis', 'Proposal Sent', 'PO Expected',
			'Negotiation/Review', 'On Hold', 'Closed Won', 'Closed Lost'
		];
	}

	stage_color(s) {
		var map = {
			'Qualification': '#378ADD',
			'Needs Analysis': '#1D9E75',
			'Value Proposition': '#BA7517',
			'Perception Analysis': '#7F77DD',
			'Proposal Sent': '#D85A30',
			'PO Expected': '#D4537E',
			'Negotiation/Review': '#533AB7',
			'On Hold': '#888780',
			'Closed Won': '#639922',
			'Closed Lost': '#E24B4A'
		};
		return map[s] || '#888780';
	}

	render_metrics() {
		var o = this.opps, l = this.leads;
		var open = o.filter(x => !['Lost', 'Closed'].includes(x.status));
		var won = o.filter(x => x.sales_stage === 'Closed Won');
		var lost = o.filter(x => x.sales_stage === 'Closed Lost');
		var pipe_val = open.reduce((s, x) => s + (x.opportunity_amount || 0), 0);
		var won_val = won.reduce((s, x) => s + (x.opportunity_amount || 0), 0);
		var lost_val = lost.reduce((s, x) => s + (x.opportunity_amount || 0), 0);
		var conv = o.length > 0 ? Math.round((won.length / o.length) * 100) : 0;
		var weighted = open.reduce((s, x) => s + ((x.opportunity_amount || 0) * (x.probability || 0) / 100), 0);

		document.getElementById('crm-metrics').innerHTML = `
			<div class="crm-metric">
				<div class="crm-metric-label">Total leads</div>
				<div class="crm-metric-val">${l.length}</div>
				<div class="crm-metric-sub">In period</div>
			</div>
			<div class="crm-metric">
				<div class="crm-metric-label">Opportunities</div>
				<div class="crm-metric-val">${o.length}</div>
				<div class="crm-metric-sub">${open.length} open</div>
			</div>
			<div class="crm-metric">
				<div class="crm-metric-label">Pipeline value</div>
				<div class="crm-metric-val">${this.fmt(pipe_val)}</div>
				<div class="crm-metric-sub">Open only</div>
			</div>
			<div class="crm-metric">
				<div class="crm-metric-label">Closed won</div>
				<div class="crm-metric-val green">${this.fmt(won_val)}</div>
				<div class="crm-metric-sub">${won.length} deal${won.length !== 1 ? 's' : ''}</div>
			</div>
			<div class="crm-metric">
				<div class="crm-metric-label">Closed lost</div>
				<div class="crm-metric-val red">${lost.length}</div>
				<div class="crm-metric-sub">${this.fmt(lost_val)}</div>
			</div>
			<div class="crm-metric">
				<div class="crm-metric-label">Conv. rate</div>
				<div class="crm-metric-val ${conv >= 30 ? 'green' : conv >= 15 ? 'orange' : 'red'}">${conv}%</div>
				<div class="crm-metric-sub">Won / total</div>
			</div>
			<div class="crm-metric">
				<div class="crm-metric-label">Weighted pipeline</div>
				<div class="crm-metric-val">${this.fmt(weighted)}</div>
				<div class="crm-metric-sub">By probability %</div>
			</div>`;
	}

	render_pipeline() {
		var html = this.get_stages().map(s => {
			var items = this.opps.filter(o => o.sales_stage === s);
			var val = items.reduce((sum, o) => sum + (o.opportunity_amount || 0), 0);
			var color = this.stage_color(s);
			return `<div class="crm-stage" style="border-top-color:${color}">
				<div class="crm-stage-name" title="${s}">${s}</div>
				<div class="crm-stage-count">${items.length}</div>
				<div class="crm-stage-val">${this.fmt(val)}</div>
			</div>`;
		}).join('');
		document.getElementById('crm-pipeline').innerHTML = html;
	}

	render_stage_chart() {
		var stages = this.get_stages().slice(0, 8);
		var ctx = document.getElementById('crm-stage-chart');
		if (!ctx || !window.Chart) return;
		this.charts['crm-stage-chart'] = new Chart(ctx, {
			type: 'bar',
			data: {
				labels: stages.map(s => s.length > 13 ? s.slice(0, 13) + '…' : s),
				datasets: [{
					label: 'Opportunities',
					data: stages.map(s => this.opps.filter(o => o.sales_stage === s).length),
					backgroundColor: stages.map(s => this.stage_color(s)),
					borderRadius: 3
				}]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				plugins: { legend: { display: false } },
				scales: {
					x: {
						ticks: { font: { size: 10 }, maxRotation: 35, autoSkip: false },
						grid: { display: false }
					},
					y: {
						ticks: { font: { size: 10 }, stepSize: 1 },
						grid: { color: 'rgba(128,128,128,0.1)' }
					}
				}
			}
		});
	}

	render_lead_chart() {
		var statuses = ['Open', 'Replied', 'Opportunity', 'Converted', 'Lost Quotation', 'Interested', 'Do Not Contact'];
		var counts = statuses.map(s => this.leads.filter(l => l.status === s).length);
		var ctx = document.getElementById('crm-lead-chart');
		if (!ctx || !window.Chart) return;
		this.charts['crm-lead-chart'] = new Chart(ctx, {
			type: 'doughnut',
			data: {
				labels: statuses,
				datasets: [{
					data: counts,
					backgroundColor: ['#378ADD', '#1D9E75', '#7F77DD', '#639922', '#E24B4A', '#BA7517', '#888780'],
					borderWidth: 2
				}]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				plugins: {
					legend: {
						position: 'right',
						labels: { font: { size: 11 }, boxWidth: 12, padding: 8 }
					}
				}
			}
		});
	}

	set_metric(m, btn) {
		this.metric = m;
		document.querySelectorAll('.crm-toggle').forEach(b => b.classList.remove('active'));
		btn.classList.add('active');
		this.render_heatmap();
	}

	get_hm_users() {
		if (!this.is_manager) return [this.current_user];
		var owners = [...new Set(this.opps.map(o => o.opportunity_owner).filter(Boolean))];
		return owners.length ? owners : [this.current_user];
	}

	hm_color(t) {
		var r = Math.round(225 + t * (15 - 225));
		var g = Math.round(245 + t * (158 - 245));
		var b = Math.round(238 + t * (117 - 238));
		return `rgb(${r},${g},${b})`;
	}

	user_display(u) {
		if (!u) return '-';
		if (u.includes('@')) {
			return u.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
		}
		return u;
	}

	render_heatmap() {
		var stages = this.get_stages();
		var users = this.get_hm_users();
		var metric = this.metric;

		var all_counts = users.flatMap(u =>
			stages.map(s => this.opps.filter(o => o.opportunity_owner === u && o.sales_stage === s).length)
		);
		var all_vals = users.flatMap(u =>
			stages.map(s => this.opps.filter(o => o.opportunity_owner === u && o.sales_stage === s)
				.reduce((sum, o) => sum + (o.opportunity_amount || 0), 0))
		);

		var max_c = Math.max(...all_counts, 1);
		var max_v = Math.max(...all_vals, 1);

		var html = `<table class="crm-hm-table"><thead><tr>
			<th class="row-h">User</th>`;
		stages.forEach(s => {
			html += `<th title="${s}">${s.length > 9 ? s.slice(0, 9) + '…' : s}</th>`;
		});
		html += `<th>Total</th></tr></thead><tbody>`;

		var grand_c = 0, grand_v = 0;

		users.forEach(u => {
			var u_total_c = 0, u_total_v = 0;
			html += `<tr><th class="row-h" style="font-size:12px;font-weight:500;text-align:left;padding:4px 6px">${this.user_display(u)}</th>`;
			stages.forEach(s => {
				var items = this.opps.filter(o => o.opportunity_owner === u && o.sales_stage === s);
				var c = items.length;
				var v = items.reduce((sum, o) => sum + (o.opportunity_amount || 0), 0);
				u_total_c += c;
				u_total_v += v;
				var t = metric === 'value' ? v / max_v : c / max_c;
				var bg = this.hm_color(t);
				var tc = t > 0.6 ? '#085041' : 'var(--text-color)';
				html += `<td style="padding:2px">
					<div class="crm-hm-cell" style="background:${bg};color:${tc}">
						<div class="cv">${metric === 'value' ? this.fmt(v) : c}</div>
						${(metric === 'count' || metric === 'both') && c > 0
							? `<div class="cs">${this.fmt(v)}</div>` : ''}
						${metric === 'both' && metric !== 'count'
							? `<div class="cs">${c} deals</div>` : ''}
					</div>
				</td>`;
			});
			grand_c += u_total_c;
			grand_v += u_total_v;
			html += `<td class="crm-row-total">${u_total_c}<br>
				<span style="font-size:10px;font-weight:400">${this.fmt(u_total_v)}</span>
			</td></tr>`;
		});

		html += `<tr><td class="row-h" style="font-size:11px;color:var(--text-muted);padding:4px 6px">Stage total</td>`;
		stages.forEach(s => {
			var sc = this.opps.filter(o => o.sales_stage === s).length;
			var sv = this.opps.filter(o => o.sales_stage === s)
				.reduce((sum, o) => sum + (o.opportunity_amount || 0), 0);
			html += `<td class="crm-col-total">${sc}<br>
				<span style="font-size:10px">${this.fmt(sv)}</span>
			</td>`;
		});
		html += `<td class="crm-row-total" style="color:var(--text-color)">${grand_c}<br>
			<span style="font-size:10px;font-weight:400">${this.fmt(grand_v)}</span>
		</td></tr></tbody></table>`;

		document.getElementById('crm-heatmap').innerHTML = html;

		var strip = '';
		for (var i = 0; i <= 12; i++) {
			strip += `<div style="flex:1;background:${this.hm_color(i / 12)}"></div>`;
		}
		document.getElementById('crm-legend-strip').innerHTML = strip;
	}

	render_sp_performance() {
		var users = this.get_hm_users();

		if (!this.is_manager) {
			var my = this.opps;
			var won = my.filter(o => o.sales_stage === 'Closed Won');
			var open = my.filter(o => !['Closed Won', 'Closed Lost'].includes(o.sales_stage));
			var val = my.reduce((s, o) => s + (o.opportunity_amount || 0), 0);
			document.getElementById('crm-sp-perf').innerHTML = `
				<div style="text-align:center;padding:20px 0">
					<div style="font-size:30px;font-weight:600">${my.length}</div>
					<div style="font-size:13px;color:var(--text-muted);margin-bottom:14px">My opportunities</div>
					<div style="display:flex;gap:20px;justify-content:center;font-size:13px">
						<span><b style="color:var(--green)">${won.length}</b> Won</span>
						<span><b>${open.length}</b> Open</span>
						<span><b>${this.fmt(val)}</b> Total</span>
					</div>
				</div>`;
			return;
		}

		var html = users.map(u => {
			var u_opps = this.opps.filter(o => o.opportunity_owner === u);
			var won = u_opps.filter(o => o.sales_stage === 'Closed Won').length;
			var open = u_opps.filter(o => !['Closed Won', 'Closed Lost'].includes(o.sales_stage)).length;
			var val = u_opps.reduce((s, o) => s + (o.opportunity_amount || 0), 0);
			var initials = this.user_display(u).split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
			var pct = u_opps.length > 0 ? Math.min(Math.round((won / u_opps.length) * 100), 100) : 0;
			var bar_color = pct >= 60 ? 'var(--green)' : pct >= 30 ? 'var(--blue)' : 'var(--red)';
			return `<div class="crm-sp-row">
				<div class="crm-sp-info">
					<div class="crm-avatar">${initials}</div>
					<div>
						<div style="font-size:13px;font-weight:500">${this.user_display(u)}</div>
						<div style="font-size:11px;color:var(--text-muted)">${won} won · ${open} open</div>
						<div class="crm-progress" style="width:150px">
							<div class="crm-progress-fill" style="width:${pct}%;background:${bar_color}"></div>
						</div>
					</div>
				</div>
				<div style="text-align:right;flex-shrink:0">
					<div style="font-size:13px;font-weight:600">${this.fmt(val)}</div>
					<div style="font-size:11px;color:var(--text-muted)">${pct}% win rate</div>
				</div>
			</div>`;
		}).join('');

		document.getElementById('crm-sp-perf').innerHTML =
			html || '<div class="crm-empty">No data for selected period</div>';
	}

	render_recent() {
		var recent = this.opps.slice(0, 10);
		if (!recent.length) {
			document.getElementById('crm-recent').innerHTML =
				'<tr><td colspan="5" class="crm-empty">No opportunities in selected period</td></tr>';
			return;
		}
		document.getElementById('crm-recent').innerHTML = recent.map(o => {
			var bc = o.sales_stage === 'Closed Won' ? 'won'
				: o.sales_stage === 'Closed Lost' ? 'lost'
				: o.sales_stage === 'On Hold' ? 'hold' : 'open';
			var owner = this.user_display(o.opportunity_owner);
			var party = o.party_name || o.customer_name || '-';
			return `<tr>
				<td style="font-weight:500;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
					title="${party}">${party}</td>
				<td><span class="crm-badge ${bc}">${o.sales_stage || '-'}</span></td>
				<td style="color:var(--text-muted);white-space:nowrap">${owner}</td>
				<td style="font-weight:500;white-space:nowrap">${this.fmt(o.opportunity_amount)}</td>
				<td style="color:var(--text-muted)">${o.status || '-'}</td>
			</tr>`;
		}).join('');
	}
}

}); // end loadChartJS
