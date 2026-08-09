import analyticsApp from './index.js';

function normalizeEntity(value = '') {
  if (!value) return '';
  try {
    const url = new URL(String(value), 'https://oceanliners.net');
    let path = url.pathname || '/';
    path = path.replace(/\/index\.html?$/i, '/').replace(/\.html?$/i, '');
    if (path.length > 1) path = path.replace(/\/$/, '');
    return path.toLowerCase();
  } catch {
    let path = String(value).trim();
    if (!path.startsWith('/')) path = `/${path}`;
    path = path.replace(/\.html?$/i, '');
    if (path.length > 1) path = path.replace(/\/$/, '');
    return path.toLowerCase();
  }
}

function round(value, places = 1) {
  const p = 10 ** places;
  return Math.round(Number(value || 0) * p) / p;
}

function severityForSignal(signal) {
  if (signal.type === 'fall') return 'medium';
  if (signal.type === 'rise' || signal.type === 'quality') return 'low';
  return 'low';
}

function titleForSignal(signal) {
  if (signal.type === 'fall') return 'Investigate declining reader attention';
  if (signal.type === 'rise') return 'Capitalize on rising reader attention';
  if (signal.type === 'quality') return 'Strengthen discovery for high-attention content';
  return signal.title || 'Analytics observation';
}

function opportunityForSignal(signal) {
  if (!signal?.path) return null;
  if (signal.type === 'rise') {
    return {
      title: 'Build on rising readership',
      summary: signal.text,
      entity: normalizeEntity(signal.path),
      meta: 'Analytics · reader attention',
      sources: ['Analytics'],
    };
  }
  if (signal.type === 'quality') {
    return {
      title: 'Improve discovery for high-engagement content',
      summary: `${signal.text} Compare this page with Search Intelligence and Link Map to see whether stronger discovery or internal linking could expose it to more readers.`,
      entity: normalizeEntity(signal.path),
      meta: 'Analytics · engagement opportunity',
      sources: ['Analytics'],
    };
  }
  return null;
}

async function buildIntelligence(request, env, ctx) {
  const dashboardUrl = new URL('/api/dashboard?days=28', request.url);
  const dashboardResponse = await analyticsApp.fetch(new Request(dashboardUrl, { headers: request.headers }), env, ctx);
  const dashboard = await dashboardResponse.json();

  if (!dashboardResponse.ok || !dashboard.ok) {
    return {
      ok: false,
      system: {
        id: 'analytics',
        name: 'Analytics',
        status: 'warning',
        statusLabel: 'Feed unavailable',
        value: 'Unavailable',
        summary: dashboard.error || 'Analytics intelligence feed could not be generated.',
        detail: 'Google Analytics Data API',
        url: 'https://analytics.oceanliners.net/',
      },
      priorities: [],
      opportunities: [],
      activity: [],
    };
  }

  const changes = dashboard.changes || {};
  const current = dashboard.current || {};
  const signals = Array.isArray(dashboard.signals) ? dashboard.signals : [];

  const priorities = signals
    .filter(signal => signal.path && ['fall', 'rise', 'quality'].includes(signal.type))
    .map(signal => ({
      title: titleForSignal(signal),
      summary: signal.text || '',
      severity: severityForSignal(signal),
      score: signal.type === 'fall' ? 58 : signal.type === 'rise' ? 42 : 38,
      entity: normalizeEntity(signal.path),
      sources: ['Analytics'],
      signalType: `analytics_${signal.type}`,
      evidence: {
        source: 'analytics',
        observedAt: dashboard.generatedAt,
        periodDays: dashboard.days,
      },
    }));

  const opportunities = signals.map(opportunityForSignal).filter(Boolean);
  const viewsChange = changes.views;
  const status = viewsChange != null && viewsChange <= -20 ? 'warning' : 'good';
  const statusLabel = status === 'good' ? 'Reporting live' : 'Attention shift';
  const changeText = viewsChange == null ? 'comparison unavailable' : `${viewsChange >= 0 ? '+' : ''}${round(viewsChange)}% vs prior 28d`;

  return {
    ok: true,
    schemaVersion: 1,
    generatedAt: dashboard.generatedAt,
    system: {
      id: 'analytics',
      name: 'Analytics',
      status,
      statusLabel,
      value: Number(current.views || 0).toLocaleString(),
      summary: `${Number(current.views || 0).toLocaleString()} views from ${Number(current.activeUsers || 0).toLocaleString()} active users in the last 28 days.`,
      detail: `${changeText} · ${round((current.engagementRate || 0) * 100)}% engagement rate`,
      url: 'https://analytics.oceanliners.net/',
    },
    priorities,
    opportunities,
    activity: [
      {
        title: 'Analytics snapshot normalized',
        summary: `Curator Intelligence received ${signals.length} Analytics signal${signals.length === 1 ? '' : 's'} for the current 28-day comparison window.`,
        meta: 'Live adapter · Analytics',
      },
    ],
    pageSignals: (dashboard.pages || []).slice(0, 30).map(page => ({
      entity: normalizeEntity(page.path),
      source: 'analytics',
      observedAt: dashboard.generatedAt,
      periodDays: dashboard.days,
      metrics: {
        views: page.views,
        users: page.users,
        previousViews: page.previousViews,
        viewChangePct: page.changePct,
        avgEngagementSeconds: page.avgEngagementSeconds,
      },
    })),
  };
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': 'https://tools.oceanliners.net',
      'vary': 'Origin',
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/curator-intelligence') {
      try {
        return json(await buildIntelligence(request, env, ctx));
      } catch (error) {
        return json({
          ok: false,
          system: {
            id: 'analytics',
            name: 'Analytics',
            status: 'warning',
            statusLabel: 'Feed unavailable',
            value: 'Unavailable',
            summary: error instanceof Error ? error.message : String(error),
            detail: 'Analytics intelligence adapter',
            url: 'https://analytics.oceanliners.net/',
          },
          priorities: [], opportunities: [], activity: [],
        }, 500);
      }
    }
    return analyticsApp.fetch(request, env, ctx);
  },
};
