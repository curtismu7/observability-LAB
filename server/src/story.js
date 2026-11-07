import { fillDeep } from './cast.js';
import { ALERT_RULES, BANNER, FACTS, INTRO, PRODUCTS, REAL_BANNER, RELABEL_RULE, SCENARIOS, TALK_TRACK, TITLE, TOOLS } from './logData.js';

export const rawStory = () => ({ title: TITLE, intro: INTRO, banner: BANNER, realBanner: REAL_BANNER, relabelRule: RELABEL_RULE, products: PRODUCTS, alertRules: ALERT_RULES, scenarios: SCENARIOS, facts: FACTS, tools: TOOLS, talkTrack: TALK_TRACK });

// The story with the cast filled in.
export function buildStory(cast) {
  const s = fillDeep(rawStory(), cast);
  return { ...s, tokenLabel: 'MOCK log lines and MOCK identifiers: for education, never real product output', cast };
}

// docs/talk-track.md is generated from the same data the UI reads (`npm run talk-track`); a test fails if they drift.
export function renderTalkTrackMarkdown(cast) {
  const s = buildStory(cast);
  const parts = ['# Talk track', '', '<!-- Generated from server/src/logData.js by `npm run talk-track`. Do not edit by hand. -->', ''];
  for (const t of s.talkTrack) parts.push(`## ${t.title}`, '', t.say, '');
  parts.push('## The scenarios', '');
  s.scenarios.forEach((sc, i) => parts.push(`${i + 1}. **${sc.title}.** ${sc.lesson}`));
  return `${parts.join('\n')}\n`;
}
