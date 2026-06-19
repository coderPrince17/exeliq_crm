// Exeliq CRM Dashboard v3
// - sales_stage is single source of truth for Opportunities
// - Stages fetched dynamically from Sales Stage doctype
// - Leads use their own status field
// - Pipeline = everything except Closed Won / Closed Lost

(function () {

	function registerPage() {
		if (!frappe.pages) { setTimeout(registerPage, 100); return; }
		if (!frappe.pages['crm-dashboard']) frappe.pages['crm-dashboard'] = {};
		frappe.pages['crm-dashboard'].on_page_load = function (wrapper) {
			if (window.Chart) { initDashboard(wrapper); return; }
			var s = document.createElement('script');
			s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
			s.onload = function () { initDashboard(wrapper); };
			document.head.appendChild(s);
		};
		frappe.pages['crm-dashboard'].on_page_show = function () {
			if (frappe.crm_dashboard) frappe.crm_dashboard.load_data();
		};
	}

	function initDashboard(wrapper) {
		var page = frappe.ui.make_app_page({
			parent: wrapper, title: 'CRM Pipeline Dashboard', single_column: true
		});
		frappe.crm_dashboard = new CRMDashboard(page);
	}

	// ── Helpers ───────────────────────────────────────────────────────

	function fmt(val) {
		val = parseFloat(val) || 0;
		if (val >= 10000000) return '₹' + (val / 10000000).toFixed(1) + ' Cr';
		if (val >= 100000)   return '₹' + (val / 100000).toFixed(1) + 'L';
		if (val >= 1000)     return '₹' + (val / 1000).toFixed(1) + 'K';
		return val > 0 ? '₹' + Math.round(val) : '₹0';
	}

	function user_label(u) {
		if (!u) return '-';
		var part = u.indexOf('@') !== -1 ? u.split('@')[0] : u;
		return part.replace(/[._]/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
	}

	function initials(u) {
		return user_label(u).split(' ').map(function (w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase();
	}

	function hm_color(t) {
		return 'rgb(' +
			Math.round(225 + t * (8   - 225)) + ',' +
			Math.round(245 + t * (110 - 245)) + ',' +
			Math.round(238 + t * (72  - 238)) + ')';
	}

	// Fixed stage colors — assigned by position so dynamic stages get consistent colors
	var PALETTE = ['#378ADD','#1D9E75','#BA7517','#7F77DD','#D85A30',
	               '#D4537E','#533AB7','#888780','#639922','#E24B4A',
	               '#2A9D8F','#E9C46A','#F4A261','#264653','#A8DADC'];

	var LEAD_STATUSES = ['Open','Replied','Opportunity','Converted','Lost Quotation','Interested','Do Not Contact'];
	var LEAD_COLORS   = ['#378ADD','#1D9E75','#7F77DD','#639922','#E24B4A','#BA7517','#888780'];

	var WON_STAGE  = 'Closed Won';
	var LOST_STAGE = 'Closed Lost';

	function is_won(o)      { return o.sales_stage === WON_STAGE; }
	function is_lost(o)     { return o.sales_stage === LOST_STAGE; }
	function is_pipeline(o) { return !is_won(o) && !is_lost(o); }

	// ── CRMDashboard ──────────────────────────────────────────────────

	function CRMDashboard(page) {
		this.page     = page;
		this.is_mgr   = frappe.user.has_role('Sales Manager') || frappe.user.has_role('System Manager');
		this.me       = frappe.session.user;
		this.metric   = 'count';
		this.charts   = {};
		this.opps     = [];
		this.leads    = [];
		this.stages   = [];        // fetched from Sales Stage doctype
		this.sp_users = [];        // fetched from Has Role
		this.stage_color_map = {};

		this.setup_html();
		this.load_meta().then(function (self) {
			self.setup_filters();
			self.load_data();
		});
	}

	// Load Sales Stages + Sales Users in parallel
	CRMDashboard.prototype.load_meta = function () {
		var self = this;
		return Promise.all([
			// Fetch all Sales Stage records in their defined order
			frappe.call({
				method: 'frappe.client.get_list',
				args: {
					doctype: 'Sales Stage',
					fields: ['name', 'stage_name'],
					limit_page_length: 100,
					order_by: 'creation asc'
				}
			}),
			// Fetch all users with Sales User role
			frappe.call({
				method: 'frappe.client.get_list',
				args: {
					doctype: 'Has Role',
					filters: [['role', '=', 'Sales User'], ['parenttype', '=', 'User']],
					fields: ['parent'],
					limit_page_length: 200
				}
			})
		]).then(function (res) {
			// Build stage list — use stage_name if available, else name
			var stage_rows = (res[0].message) || [];
			self.stages = stage_rows.map(function (r) { return r.stage_name || r.name; });

			// Make sure Won and Lost are always in the list
			if (self.stages.indexOf(WON_STAGE) === -1)  self.stages.push(WON_STAGE);
			if (self.stages.indexOf(LOST_STAGE) === -1) self.stages.push(LOST_STAGE);

			// Assign colors by position
			self.stage_color_map = {};
			self.stages.forEach(function (s, i) {
				self.stage_color_map[s] = PALETTE[i % PALETTE.length];
			});

			// Build sales users list
			var sp_rows = (res[1].message) || [];
			self.sp_users = sp_rows.map(function (r) { return r.parent; }).filter(function (u) {
				return u && u !== 'Administrator' && u.indexOf('Guest') === -1;
			});

			return self;
		}).catch(function () { return self; });
	};

	CRMDashboard.prototype.stage_color = function (s) {
		return this.stage_color_map[s] || '#888780';
	};

	// ── Filters ───────────────────────────────────────────────────────

	CRMDashboard.prototype.setup_filters = function () {
		var self = this;

		this.f_period = this.page.add_field({
			fieldtype: 'Select', fieldname: 'period', label: 'Range',
			options: ['Today','This Week','This Month','Last Month',
			          'This Quarter','Last Quarter','This Year','Custom'].join('\n'),
			default: 'This Month',
			change: function () {
				var p = self.f_period.get_value();
				if (p === 'Custom') return;
				var d = self.period_dates(p);
				self.f_from.set_value(d[0]);
				self.f_to.set_value(d[1]);
				self.load_data();
			}
		});

		var def = this.period_dates('This Month');
		this.f_from = this.page.add_field({
			fieldtype: 'Date', fieldname: 'date_from', label: 'From',
			default: def[0],
			change: function () { self.f_period.set_value('Custom'); self.load_data(); }
		});
		this.f_to = this.page.add_field({
			fieldtype: 'Date', fieldname: 'date_to', label: 'To',
			default: def[1],
			change: function () { self.f_period.set_value('Custom'); self.load_data(); }
		});

		if (this.is_mgr) {
			this.f_sp = this.page.add_field({
				fieldtype: 'Select', fieldname: 'salesperson', label: 'Salesperson',
				options: ['All'].concat(this.sp_users).join('\n'),
				default: 'All',
				change: function () { self.load_data(); }
			});
		}

		this.page.add_inner_button('Refresh', function () { self.load_data(); });
	};

	CRMDashboard.prototype.period_dates = function (p) {
		var now = frappe.datetime.now_date();
		if (p === 'Today')        return [now, now];
		if (p === 'This Week')    return [frappe.datetime.week_start(), now];
		if (p === 'This Month')   return [frappe.datetime.month_start(), now];
		if (p === 'This Quarter') return [frappe.datetime.quarter_start(), now];
		if (p === 'This Year')    return [frappe.datetime.year_start(), now];
		if (p === 'Last Month') {
			var d = frappe.datetime.str_to_obj(frappe.datetime.month_start());
			d.setDate(d.getDate() - 1);
			var end = frappe.datetime.obj_to_str(d);
			d.setDate(1);
			return [frappe.datetime.obj_to_str(d), end];
		}
		if (p === 'Last Quarter') {
			var qs = frappe.datetime.str_to_obj(frappe.datetime.quarter_start());
			qs.setDate(qs.getDate() - 1);
			var qe = frappe.datetime.obj_to_str(qs);
			var qsm = new Date(qs);
			qsm.setMonth(qsm.getMonth() - 2); qsm.setDate(1);
			return [frappe.datetime.obj_to_str(qsm), qe];
		}
		return [frappe.datetime.month_start(), now];
	};

	CRMDashboard.prototype.get_f = function () {
		return {
			from: (this.f_from && this.f_from.get_value()) || frappe.datetime.month_start(),
			to:   (this.f_to   && this.f_to.get_value())   || frappe.datetime.now_date(),
			sp:   (this.is_mgr && this.f_sp && this.f_sp.get_value() !== 'All') ? this.f_sp.get_value() : null
		};
	};

	// ── Data loading ──────────────────────────────────────────────────

	CRMDashboard.prototype.destroy_charts = function () {
		var self = this;
		Object.keys(self.charts).forEach(function (k) {
			if (self.charts[k]) { self.charts[k].destroy(); delete self.charts[k]; }
		});
	};

	CRMDashboard.prototype.load_data = function () {
		var self = this, f = this.get_f();
		this.destroy_charts();
		document.getElementById('crm-metrics').innerHTML =
			'<div class="crm-metric"><div class="crm-metric-label">Loading…</div></div>';

		var opp_filters = [
			['modified', '>=', f.from + ' 00:00:00'],
			['modified', '<=', f.to   + ' 23:59:59']
		];
		var lead_filters = [
			['modified', '>=', f.from + ' 00:00:00'],
			['modified', '<=', f.to   + ' 23:59:59']
		];

		if (!this.is_mgr) {
			opp_filters.push(['opportunity_owner', '=', this.me]);
			lead_filters.push(['lead_owner', '=', this.me]);
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
					fields: ['name', 'party_name', 'customer_name', 'sales_stage',
					         'opportunity_amount', 'opportunity_owner', 'transaction_date',
					         'territory', 'modified'],
					limit_page_length: 500,
					order_by: 'modified desc'
				}
			}),
			frappe.call({
				method: 'frappe.client.get_list',
				args: {
					doctype: 'Lead',
					filters: lead_filters,
					fields: ['name', 'lead_name', 'company_name', 'status',
					         'lead_owner', 'creation', 'territory', 'modified'],
					limit_page_length: 500
				}
			})
		]).then(function (res) {
			self.opps  = (res[0].message) || [];
			self.leads = (res[1].message) || [];
			self.render_all();
		}).catch(function (err) {
			document.getElementById('crm-metrics').innerHTML =
				'<div style="color:var(--red);padding:10px">Error loading data. Check console.</div>';
			console.error('CRM Dashboard:', err);
		});
	};

	CRMDashboard.prototype.render_all = function () {
		this.render_metrics();
		this.render_pipeline();
		this.render_stage_chart();
		this.render_lead_chart();
		this.render_territory();
		this.render_heatmap();
		this.render_sp_perf();
		this.render_recent();
	};

	// ── Metrics ───────────────────────────────────────────────────────

	CRMDashboard.prototype.render_metrics = function () {
		var o = this.opps, l = this.leads;
		var pipeline = o.filter(is_pipeline);
		var won      = o.filter(is_won);
		var lost     = o.filter(is_lost);
		var pipe_val = pipeline.reduce(function (s, x) { return s + (parseFloat(x.opportunity_amount) || 0); }, 0);
		var won_val  = won.reduce(function (s, x)      { return s + (parseFloat(x.opportunity_amount) || 0); }, 0);
		var lost_val = lost.reduce(function (s, x)     { return s + (parseFloat(x.opportunity_amount) || 0); }, 0);
		var closed   = won.length + lost.length;
		var conv     = closed > 0 ? Math.round((won.length / closed) * 100) : 0;

		var cards = [
			['Total Leads',    l.length,        'In period',                   ''],
			['Opportunities',  o.length,        pipeline.length + ' in pipeline', ''],
			['Pipeline Value', fmt(pipe_val),   'Excl. Won & Lost',            ''],
			['Closed Won',     fmt(won_val),    won.length + ' deals',         'green'],
			['Closed Lost',    lost.length,     fmt(lost_val),                 'red'],
			['Conv. Rate',     conv + '%',      'Won / (Won + Lost)',           conv >= 30 ? 'green' : 'red']
		];
		document.getElementById('crm-metrics').innerHTML = cards.map(function (c) {
			return '<div class="crm-metric">' +
				'<div class="crm-metric-label">' + c[0] + '</div>' +
				'<div class="crm-metric-val ' + c[3] + '">' + c[1] + '</div>' +
				'<div class="crm-metric-sub">' + c[2] + '</div></div>';
		}).join('');
	};

	// ── Pipeline strip ────────────────────────────────────────────────

	CRMDashboard.prototype.render_pipeline = function () {
		var self = this, o = this.opps;
		document.getElementById('crm-pipeline').innerHTML = this.stages.map(function (s) {
			var items = o.filter(function (x) { return x.sales_stage === s; });
			var val   = items.reduce(function (sum, x) { return sum + (parseFloat(x.opportunity_amount) || 0); }, 0);
			return '<div class="crm-stage" style="border-top-color:' + self.stage_color(s) + '">' +
				'<div class="crm-stage-name" title="' + s + '">' + s + '</div>' +
				'<div class="crm-stage-count">' + items.length + '</div>' +
				'<div class="crm-stage-val">' + fmt(val) + '</div></div>';
		}).join('');
	};

	// ── Stage bar chart ───────────────────────────────────────────────

	CRMDashboard.prototype.render_stage_chart = function () {
		var self = this, o = this.opps;
		var ctx = document.getElementById('crm-stage-chart');
		if (!ctx || !window.Chart) return;
		// Show all stages except Won/Lost in bar chart for pipeline view
		var pipeline_stages = this.stages.filter(function (s) {
			return s !== WON_STAGE && s !== LOST_STAGE;
		});
		this.charts['stage'] = new Chart(ctx, {
			type: 'bar',
			data: {
				labels: pipeline_stages.map(function (s) { return s.length > 12 ? s.slice(0, 12) + '…' : s; }),
				datasets: [{
					label: 'Opportunities',
					data: pipeline_stages.map(function (s) {
						return o.filter(function (x) { return x.sales_stage === s; }).length;
					}),
					backgroundColor: pipeline_stages.map(function (s) { return self.stage_color(s); }),
					borderRadius: 3
				}]
			},
			options: {
				responsive: true, maintainAspectRatio: false,
				plugins: { legend: { display: false } },
				scales: {
					x: { ticks: { font: { size: 9 }, maxRotation: 40, autoSkip: false }, grid: { display: false } },
					y: { ticks: { font: { size: 10 }, stepSize: 1 }, grid: { color: 'rgba(128,128,128,0.1)' } }
				}
			}
		});
	};

	// ── Lead status donut ─────────────────────────────────────────────

	CRMDashboard.prototype.render_lead_chart = function () {
		var l = this.leads;
		var counts = LEAD_STATUSES.map(function (s) {
			return l.filter(function (x) { return x.status === s; }).length;
		});
		var total = counts.reduce(function (a, b) { return a + b; }, 0);
		var ctx = document.getElementById('crm-lead-chart');
		if (!ctx) return;
		if (total === 0) {
			ctx.parentElement.innerHTML = '<div class="crm-empty">No leads in selected period</div>';
			return;
		}
		if (!window.Chart) return;
		this.charts['lead'] = new Chart(ctx, {
			type: 'doughnut',
			data: {
				labels: LEAD_STATUSES,
				datasets: [{ data: counts, backgroundColor: LEAD_COLORS, borderWidth: 2 }]
			},
			options: {
				responsive: true, maintainAspectRatio: false,
				plugins: { legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 12, padding: 8 } } }
			}
		});
	};

	// ── Territory chart ───────────────────────────────────────────────

	CRMDashboard.prototype.render_territory = function () {
		var o = this.opps, l = this.leads;
		var map = {};
		o.forEach(function (x) {
			if (!x.territory) return;
			if (!map[x.territory]) map[x.territory] = { opp: 0, lead: 0, val: 0 };
			map[x.territory].opp++;
			map[x.territory].val += parseFloat(x.opportunity_amount) || 0;
		});
		l.forEach(function (x) {
			if (!x.territory) return;
			if (!map[x.territory]) map[x.territory] = { opp: 0, lead: 0, val: 0 };
			map[x.territory].lead++;
		});
		var terrs = Object.keys(map)
			.sort(function (a, b) { return (map[b].opp + map[b].lead) - (map[a].opp + map[a].lead); })
			.slice(0, 10);
		var el = document.getElementById('crm-territory-chart');
		if (!el) return;
		if (terrs.length === 0) {
			el.parentElement.innerHTML = '<div class="crm-empty">No territory data in selected period</div>';
			return;
		}
		if (!window.Chart) return;
		this.charts['territory'] = new Chart(el, {
			type: 'bar',
			data: {
				labels: terrs,
				datasets: [
					{ label: 'Opportunities', data: terrs.map(function (t) { return map[t].opp; }),  backgroundColor: '#378ADD', borderRadius: 3 },
					{ label: 'Leads',         data: terrs.map(function (t) { return map[t].lead; }), backgroundColor: '#1D9E75', borderRadius: 3 }
				]
			},
			options: {
				responsive: true, maintainAspectRatio: false, indexAxis: 'y',
				plugins: { legend: { position: 'top', labels: { font: { size: 11 }, boxWidth: 12 } } },
				scales: {
					x: { ticks: { font: { size: 10 }, stepSize: 1 }, grid: { color: 'rgba(128,128,128,0.1)' } },
					y: { ticks: { font: { size: 11 } }, grid: { display: false } }
				}
			}
		});
	};

	// ── Heatmap ───────────────────────────────────────────────────────

	CRMDashboard.prototype.set_metric = function (m, btn) {
		this.metric = m;
		document.querySelectorAll('.crm-toggle').forEach(function (b) { b.classList.remove('active'); });
		btn.classList.add('active');
		this.render_heatmap();
	};

	CRMDashboard.prototype.hm_users = function () {
		if (!this.is_mgr) return [this.me];
		var seen = {}, result = [];
		this.sp_users.forEach(function (u) { if (!seen[u]) { seen[u] = 1; result.push(u); } });
		this.opps.forEach(function (o) {
			if (o.opportunity_owner && !seen[o.opportunity_owner]) {
				seen[o.opportunity_owner] = 1; result.push(o.opportunity_owner);
			}
		});
		return result;
	};

	CRMDashboard.prototype.render_heatmap = function () {
		var self = this, users = this.hm_users(), metric = this.metric;
		var all_c = [], all_v = [];
		users.forEach(function (u) {
			self.stages.forEach(function (s) {
				var items = self.opps.filter(function (o) { return o.opportunity_owner === u && o.sales_stage === s; });
				all_c.push(items.length);
				all_v.push(items.reduce(function (sum, o) { return sum + (parseFloat(o.opportunity_amount) || 0); }, 0));
			});
		});
		var max_c = Math.max.apply(null, all_c.concat([1]));
		var max_v = Math.max.apply(null, all_v.concat([1]));

		var html = '<table class="crm-hm-table"><thead><tr><th class="row-h">User</th>';
		this.stages.forEach(function (s) {
			html += '<th title="' + s + '">' + (s.length > 9 ? s.slice(0, 9) + '…' : s) + '</th>';
		});
		html += '<th>Total</th></tr></thead><tbody>';

		var g_c = 0, g_v = 0;
		users.forEach(function (u) {
			var u_c = 0, u_v = 0;
			html += '<tr><th class="row-h">' + user_label(u) + '</th>';
			self.stages.forEach(function (s) {
				var items = self.opps.filter(function (o) { return o.opportunity_owner === u && o.sales_stage === s; });
				var c = items.length;
				var v = items.reduce(function (sum, o) { return sum + (parseFloat(o.opportunity_amount) || 0); }, 0);
				u_c += c; u_v += v;
				var t  = metric === 'value' ? v / max_v : c / max_c;
				var bg = hm_color(t);
				var tc = t > 0.55 ? '#04342C' : 'inherit';
				html += '<td><div class="crm-hm-cell" style="background:' + bg + ';color:' + tc + '">' +
					'<div class="cv">' + (metric === 'value' ? fmt(v) : c) + '</div>' +
					(metric === 'both' && c > 0 ? '<div class="cs">' + fmt(v) + '</div>' : '') +
					'</div></td>';
			});
			g_c += u_c; g_v += u_v;
			html += '<td class="crm-hm-total">' + u_c + '<br><span>' + fmt(u_v) + '</span></td></tr>';
		});

		html += '<tr><td class="row-h crm-hm-footer">Stage total</td>';
		this.stages.forEach(function (s) {
			var sc = self.opps.filter(function (o) { return o.sales_stage === s; }).length;
			var sv = self.opps.filter(function (o) { return o.sales_stage === s; })
				.reduce(function (sum, o) { return sum + (parseFloat(o.opportunity_amount) || 0); }, 0);
			html += '<td class="crm-hm-footer" style="text-align:center">' + sc + '<br><span style="font-size:10px">' + fmt(sv) + '</span></td>';
		});
		html += '<td class="crm-hm-total crm-hm-footer">' + g_c + '<br><span>' + fmt(g_v) + '</span></td></tr>';
		html += '</tbody></table>';
		document.getElementById('crm-heatmap').innerHTML = html;

		var strip = '';
		for (var i = 0; i <= 16; i++) strip += '<div style="flex:1;background:' + hm_color(i / 16) + '"></div>';
		document.getElementById('crm-legend-strip').innerHTML = strip;
	};

	// ── Salesperson performance ───────────────────────────────────────

	CRMDashboard.prototype.render_sp_perf = function () {
		var self = this, users = this.hm_users();
		if (!this.is_mgr) {
			var my   = this.opps;
			var won  = my.filter(is_won).length;
			var pipe = my.filter(is_pipeline).length;
			var val  = my.reduce(function (s, o) { return s + (parseFloat(o.opportunity_amount) || 0); }, 0);
			document.getElementById('crm-sp-perf').innerHTML =
				'<div style="text-align:center;padding:24px 0">' +
				'<div style="font-size:32px;font-weight:600">' + my.length + '</div>' +
				'<div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">My opportunities</div>' +
				'<div style="display:flex;gap:24px;justify-content:center;font-size:13px">' +
				'<span><b style="color:var(--green)">' + won + '</b> Won</span>' +
				'<span><b>' + pipe + '</b> Pipeline</span>' +
				'<span><b>' + fmt(val) + '</b> Total</span></div></div>';
			return;
		}
		document.getElementById('crm-sp-perf').innerHTML = users.length ? users.map(function (u) {
			var u_o  = self.opps.filter(function (o) { return o.opportunity_owner === u; });
			var won  = u_o.filter(is_won).length;
			var pipe = u_o.filter(is_pipeline).length;
			var val  = u_o.reduce(function (s, o) { return s + (parseFloat(o.opportunity_amount) || 0); }, 0);
			var pct  = u_o.length > 0 ? Math.round((won / u_o.length) * 100) : 0;
			var bc   = pct >= 60 ? 'var(--green)' : pct >= 30 ? 'var(--blue)' : 'var(--red)';
			return '<div class="crm-sp-row">' +
				'<div class="crm-sp-info">' +
				'<div class="crm-avatar">' + initials(u) + '</div>' +
				'<div><div style="font-size:13px;font-weight:500">' + user_label(u) + '</div>' +
				'<div style="font-size:11px;color:var(--text-muted)">' + won + ' won · ' + pipe + ' pipeline</div>' +
				'<div class="crm-progress" style="width:140px"><div class="crm-progress-fill" style="width:' + pct + '%;background:' + bc + '"></div></div></div></div>' +
				'<div style="text-align:right">' +
				'<div style="font-size:13px;font-weight:600">' + fmt(val) + '</div>' +
				'<div style="font-size:11px;color:var(--text-muted)">' + pct + '% win rate</div></div></div>';
		}).join('') : '<div class="crm-empty">No data for selected period</div>';
	};

	// ── Recent opportunities ──────────────────────────────────────────

	CRMDashboard.prototype.render_recent = function () {
		var self = this;
		var rows = this.opps.slice(0, 15);
		document.getElementById('crm-recent').innerHTML = rows.length ? rows.map(function (o) {
			var bc    = is_won(o) ? 'won' : is_lost(o) ? 'lost' : o.sales_stage === 'On Hold' ? 'hold' : 'open';
			var party = o.party_name || o.customer_name || '-';
			return '<tr>' +
				'<td style="font-weight:500;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + party + '">' + party + '</td>' +
				'<td><span class="crm-badge ' + bc + '">' + (o.sales_stage || '-') + '</span></td>' +
				'<td style="color:var(--text-muted);white-space:nowrap">' + user_label(o.opportunity_owner) + '</td>' +
				'<td style="font-weight:500;white-space:nowrap">' + fmt(o.opportunity_amount) + '</td>' +
				'<td style="color:var(--text-muted)">' + (o.territory || '-') + '</td></tr>';
		}).join('') : '<tr><td colspan="5" class="crm-empty">No opportunities in selected period</td></tr>';
	};

	// ── HTML skeleton ─────────────────────────────────────────────────

	CRMDashboard.prototype.setup_html = function () {
		var self = this;
		this.page.main.html(`
<style>
.crm-dash{padding:16px 20px}
.crm-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:18px}
.crm-metric{background:var(--fg-color);border:1px solid var(--border-color);border-radius:8px;padding:14px 16px}
.crm-metric-label{font-size:10px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em}
.crm-metric-val{font-size:22px;font-weight:600;color:var(--text-color)}
.crm-metric-sub{font-size:11px;color:var(--text-muted);margin-top:3px}
.crm-metric-val.green{color:var(--green)}.crm-metric-val.red{color:var(--red)}
.crm-card{background:var(--fg-color);border:1px solid var(--border-color);border-radius:8px;padding:16px;margin-bottom:16px}
.crm-section-title{font-size:10px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px}
.crm-two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
@media(max-width:800px){.crm-two-col{grid-template-columns:1fr}}
.crm-pipeline{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px}
.crm-stage{flex:0 0 auto;min-width:110px;border:1px solid var(--border-color);border-radius:8px;padding:12px;border-top:3px solid #888}
.crm-stage-name{font-size:10px;color:var(--text-muted);margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.crm-stage-count{font-size:22px;font-weight:600}.crm-stage-val{font-size:10px;color:var(--text-muted);margin-top:2px}
.crm-hm-wrap{overflow-x:auto}
.crm-hm-table{width:100%;border-collapse:separate;border-spacing:3px;min-width:700px;font-size:11px}
.crm-hm-table th{color:var(--text-muted);padding:4px 6px;text-align:center;font-weight:500;white-space:nowrap}
.crm-hm-table th.row-h{text-align:left;min-width:120px;font-size:12px;font-weight:500}
.crm-hm-cell{border-radius:4px;padding:8px 2px;text-align:center}
.crm-hm-cell .cv{font-size:13px;font-weight:600}.crm-hm-cell .cs{font-size:9px;margin-top:1px;opacity:.9}
.crm-hm-total{font-size:12px;font-weight:600;padding:4px 8px;text-align:center;color:var(--text-muted)}
.crm-hm-total span{font-size:10px;font-weight:400}
.crm-hm-footer{color:var(--text-muted)!important;font-weight:400!important;font-size:11px!important;padding:3px 6px!important}
.crm-toggle-row{display:flex;gap:6px;margin-bottom:12px}
.crm-toggle{font-size:12px;padding:4px 14px;border-radius:4px;border:1px solid var(--border-color);background:var(--fg-color);color:var(--text-muted);cursor:pointer}
.crm-toggle.active{background:var(--blue-tint,#e6f1fb);color:var(--blue);border-color:var(--blue)}
.crm-legend{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:11px;color:var(--text-muted)}
.crm-legend-strip{display:flex;height:8px;width:120px;border-radius:3px;overflow:hidden}
.crm-sp-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.crm-sp-info{display:flex;align-items:center;gap:10px}
.crm-avatar{width:34px;height:34px;border-radius:50%;background:var(--blue-tint,#e6f1fb);color:var(--blue);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;flex-shrink:0}
.crm-progress{height:4px;background:var(--border-color);border-radius:2px;margin-top:5px}
.crm-progress-fill{height:100%;border-radius:2px;transition:width .3s}
.crm-table{width:100%;border-collapse:collapse;font-size:13px}
.crm-table th{text-align:left;font-size:10px;color:var(--text-muted);padding:6px 8px;border-bottom:1px solid var(--border-color);font-weight:500;white-space:nowrap;text-transform:uppercase;letter-spacing:.04em}
.crm-table td{padding:8px;border-bottom:1px solid var(--border-color)}
.crm-table tr:last-child td{border-bottom:none}
.crm-badge{display:inline-block;font-size:11px;padding:2px 8px;border-radius:4px;font-weight:500}
.crm-badge.won{background:var(--green-tint,#eaf3de);color:var(--green)}
.crm-badge.lost{background:var(--red-tint,#fcebeb);color:var(--red)}
.crm-badge.open{background:var(--blue-tint,#e6f1fb);color:var(--blue)}
.crm-badge.hold{background:var(--yellow-tint,#faeeda);color:var(--orange,#854f0b)}
.crm-empty{text-align:center;padding:32px;color:var(--text-muted);font-size:13px}
</style>
<div class="crm-dash">
  <div id="crm-metrics" class="crm-metrics">
    <div class="crm-metric"><div class="crm-metric-label">Loading…</div></div>
  </div>
  <div class="crm-card">
    <div class="crm-section-title">Pipeline by stage</div>
    <div id="crm-pipeline" class="crm-pipeline"></div>
  </div>
  <div class="crm-two-col">
    <div class="crm-card">
      <div class="crm-section-title">Stage breakdown (pipeline only)</div>
      <div style="position:relative;height:220px"><canvas id="crm-stage-chart"></canvas></div>
    </div>
    <div class="crm-card">
      <div class="crm-section-title">Lead status distribution</div>
      <div style="position:relative;height:220px"><canvas id="crm-lead-chart"></canvas></div>
    </div>
  </div>
  <div class="crm-card">
    <div class="crm-section-title">Territory distribution — opportunities &amp; leads (top 10)</div>
    <div style="position:relative;height:280px"><canvas id="crm-territory-chart"></canvas></div>
  </div>
  <div class="crm-card">
    <div class="crm-section-title">Pipeline heatmap — users vs stages</div>
    <div class="crm-toggle-row">
      <button class="crm-toggle active" id="hm-count">Deal count</button>
      <button class="crm-toggle" id="hm-value">Deal value (₹)</button>
      <button class="crm-toggle" id="hm-both">Both</button>
    </div>
    <div class="crm-hm-wrap"><div id="crm-heatmap"></div></div>
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
          <thead><tr>
            <th>Party</th><th>Stage</th><th>Owner</th>
            <th>Amount</th><th>Territory</th>
          </tr></thead>
          <tbody id="crm-recent"></tbody>
        </table>
      </div>
    </div>
  </div>
</div>`);

		this.page.main[0].querySelector('#hm-count').onclick = function () { self.set_metric('count', this); };
		this.page.main[0].querySelector('#hm-value').onclick = function () { self.set_metric('value', this); };
		this.page.main[0].querySelector('#hm-both').onclick  = function () { self.set_metric('both',  this); };
	};

	registerPage();
})();
