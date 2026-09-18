// The one sample draft used by the mock provider, the options-page "try it" step, UI tests and the e2e suite.
// Same message as the design mock, so the extension can be compared against it.
import type { PassA, PassB, PassC, PassS } from './schemas';

export const SAMPLE_SUBJECT = 'Proposal: a four-day week pilot for Q4';

export const SAMPLE_PARAGRAPHS = [
  'Hi all,',
  'I want to put a four-day work week pilot on the table for Q4.',
  "The evidence is stronger than people assume. When Microsoft Japan tried it in 2019, productivity jumped 40%. Iceland ran trials covering more than 1% of its entire workforce, and the results were good enough that most unions negotiated shorter hours afterward. In the UK's 2022 pilot, not a single company went back to five days.",
  "Closer to home, everyone I've talked to on the team wants this, so I don't think we have a retention risk to worry about. If anything, this becomes our best recruiting story.",
  "I'd suggest a three-month pilot for engineering and design, with a checkpoint at six weeks. Support and sales can follow once we've worked out coverage.",
  "Can we get 20 minutes on Thursday's agenda?",
  '— Jordan',
];

export const SAMPLE_TEXT = SAMPLE_PARAGRAPHS.join('\n\n');

/**
 * The same message as Jordan first dictated it: ask at the end, the hallway evidence before the trials, filler
 * throughout. The structure pass turns it into SAMPLE_PARAGRAPHS, so the whole chain (S, then A, B, C on the
 * reordered text) runs on canned data. Every word of four letters or more in SAMPLE_TEXT appears here, which is
 * what the voice gate in validatePassS checks.
 */
export const SAMPLE_DICTATED_PARAGRAPHS = [
  'Hi all,',
  "ok so I've been going back and forth on this, um, everyone I've talked to on the team wants this, so I don't think we have a retention risk to worry about, if anything this becomes our best recruiting story, closer to home I mean.",
  "When Microsoft Japan tried it in 2019, productivity jumped 40%. Iceland ran trials covering more than 1% of its entire workforce, and the results were good enough that most unions negotiated shorter hours afterward. In the UK's 2022 pilot, not a single company went back to five days. So yeah the evidence is stronger than people assume.",
  "Anyway what I want is to put a four-day work week pilot on the table for Q4. I'd suggest a three-month pilot for engineering and design, with a checkpoint at six weeks, and support and sales can follow once we've worked out coverage I guess. Can we get 20 minutes on Thursday's agenda?",
  '— Jordan',
];
export const SAMPLE_DICTATED_TEXT = SAMPLE_DICTATED_PARAGRAPHS.join('\n\n');
/** A phrase only the dictated draft contains; the mock provider keys its structure answer on it. */
export const SAMPLE_DICTATED_MARKER = "ok so I've been going back and forth";

export const SAMPLE_PASS_S: PassS = {
  verdict: 'reorder',
  note: 'The ask was in the last paragraph and the hallway evidence came before the trials. Same sentences: the ask first, the evidence in one block, then the plan.',
  paragraphs: SAMPLE_PARAGRAPHS,
  roles: ['Greeting', 'Ask', 'Evidence', 'The team', 'Plan', 'Next step', 'Sign-off'],
};

/**
 * The same email before it was a draft: notes. The structure pass answers with an outline whose slots quote these
 * fragments; the first line says who it is for and lands in no slot, so Apply outline drops it (and the mock, which
 * keys on it, then answers `keeps` for the written message).
 */
export const SAMPLE_IDEA_PARAGRAPHS = [
  'Email to leadership about a four-day week pilot.',
  "Ask: 20 minutes on Thursday's agenda.",
  'The evidence: Microsoft Japan 2019, 40% productivity; Iceland trials; the UK 2022 pilot, nobody went back to five days.',
  'Everyone on the team wants it, recruiting story.',
  'Plan: three months, engineering and design first, checkpoint at six weeks.',
];
export const SAMPLE_IDEA_TEXT = SAMPLE_IDEA_PARAGRAPHS.join('\n');
export const SAMPLE_IDEA_MARKER = 'Email to leadership about';

export const SAMPLE_PASS_S_OUTLINE: PassS = {
  verdict: 'outline',
  note: 'Lead with the ask, then say what you are proposing; the evidence, the team and the plan follow. The proposal itself has nothing yet.',
  paragraphs: [],
  slots: [
    { role: 'Ask', job: 'What you want from them, first.', from: ["Ask: 20 minutes on Thursday's agenda."] },
    { role: 'The proposal', job: 'What a yes means: the pilot in one sentence.', from: [], gap: 'Which teams, for how long, starting when.' },
    { role: 'Evidence', job: 'Outside results, with names and numbers.', from: ['The evidence: Microsoft Japan 2019, 40% productivity; Iceland trials; the UK 2022 pilot, nobody went back to five days.'], gap: 'What the Iceland trials measured.' },
    { role: 'The team', job: 'Why this is safe to try here.', from: ['Everyone on the team wants it, recruiting story.'] },
    { role: 'Plan', job: 'How it runs and when you check.', from: ['Plan: three months, engineering and design first, checkpoint at six weeks.'] },
  ],
};

export const SAMPLE_PASS_S_KEEPS: PassS = {
  verdict: 'keeps',
  note: 'The ask opens, the evidence follows it, and the plan closes. The order holds.',
  paragraphs: [],
};

export const SAMPLE_PASS_A: PassA = {
  clarity: [
    {
      id: 'c1',
      quote: 'The evidence is stronger than people assume.',
      kind: 'fuzzy',
      note: 'Who is "people"? If you are preempting a specific objection ("this is a perk, not a productivity move"), name it. As written it reads as a straw man.',
      suggestion: 'The evidence is stronger than the "nice perk" framing suggests.',
      severity: 'medium',
    },
    {
      id: 'c2',
      quote: "so I don't think we have a retention risk to worry about",
      kind: 'hedge',
      note: 'Double hedge: "don\'t think" plus "to worry about". Say what you believe. The evidence for it is also a hallway sample, which is the second challenge.',
      suggestion: 'so retention risk looks low, at least in engineering',
      severity: 'medium',
    },
  ],
  claims: [
    {
      id: 'f1',
      quote: 'productivity jumped 40%',
      statement: "Microsoft Japan's 2019 four-day week trial raised productivity by 40%.",
      checkable: true,
      type: 'statistic',
      entities: ['Microsoft Japan'],
    },
    {
      id: 'f2',
      quote: 'more than 1% of its entire workforce',
      statement: "Iceland's four-day week trials covered more than 1% of its workforce.",
      checkable: true,
      type: 'statistic',
      entities: ['Iceland'],
    },
    {
      id: 'f3',
      quote: 'not a single company went back to five days',
      statement: "No company in the UK's 2022 four-day week pilot returned to a five-day week.",
      checkable: true,
      type: 'event',
      entities: ['UK four-day week pilot 2022'],
    },
  ],
};

export const SAMPLE_PASS_B: PassB = {
  verdicts: [
    {
      claimId: 'f1',
      status: 'needs_precision',
      finding:
        'Microsoft Japan reported a 39.9% rise in sales per employee during a one-month trial in August 2019. The number holds, but it measures sales per employee over four weeks, not sustained productivity, and the company did not make the schedule permanent.',
      confidence: 4,
      sources: [
        {
          url: 'https://news.microsoft.com/ja-jp/2019/10/31/191031-published-the-results-of-measuring-the-effectiveness-of-our-work-life-choice-challenge-summer-2019/',
          title: 'Work-Life Choice Challenge Summer 2019, results',
          publisher: 'Microsoft Japan',
          date: 'Oct 2019',
        },
      ],
      suggestion: 'sales per employee rose almost 40% during a one-month trial',
    },
    {
      claimId: 'f2',
      status: 'supported',
      finding:
        "The Reykjavík City and national government trials (2015–2019) involved about 2,500 workers, roughly 1% of Iceland's working population.",
      confidence: 5,
      sources: [
        {
          url: 'https://autonomy.work/portfolio/icelandsww/',
          title: "Going Public: Iceland's Journey to a Shorter Working Week",
          publisher: 'Autonomy & Alda',
          date: '2021',
        },
      ],
    },
    {
      claimId: 'f3',
      status: 'contradicted',
      finding:
        'Of 61 companies in the June–December 2022 pilot, 56 continued with a four-day week when it ended and 18 made it permanent. At least three paused or returned to five days. "Not a single" is contradicted; "almost all" is supported.',
      confidence: 5,
      sources: [
        {
          url: 'https://autonomy.work/portfolio/uk4dwpilotresults/',
          title: "The results are in: the UK's four-day week pilot",
          publisher: 'Autonomy',
          date: 'Feb 2023',
        },
      ],
      suggestion: '56 of the 61 companies kept it',
    },
  ],
};

export const SAMPLE_PASS_C: PassC = {
  thesis: "Other companies' four-day week trials raised productivity and kept people, and our team wants one, so we should pilot it in Q4.",
  premises: [
    'Trials elsewhere raised productivity.',
    'Trial companies kept the schedule.',
    'The team wants it, so retention is safe.',
  ],
  challenges: [
    {
      id: 'ch1',
      kind: 'strongest_rebuttal',
      title: 'The trials you cite were opt-in and self-reported.',
      body: "Microsoft Japan, Iceland and the UK pilot all measured organisations that volunteered, and most productivity figures were reported by the companies themselves. A sceptic will say the evidence shows four-day weeks work at companies already convinced they will, which describes you, not the people you're trying to persuade. Microsoft Japan itself did not adopt the schedule permanently.",
      howToAddress: 'Acknowledge it, then lean on your pilot design: pre-agreed metrics and a comparison team that stays on five days.',
      anchors: ['When Microsoft Japan tried it in 2019', "In the UK's 2022 pilot"],
      sources: [
        { url: 'https://autonomy.work/portfolio/uk4dwpilotresults/', title: 'UK pilot report, methodology section', publisher: 'Autonomy', date: 'Feb 2023' },
      ],
    },
    {
      id: 'ch2',
      kind: 'blind_spot',
      title: 'Your retention evidence is a hallway sample.',
      body: '"Everyone I\'ve talked to" is engineers and designers, the people who would get the benefit first. Support and sales, who are asked to wait, are the group most likely to read this as a two-tier policy, and the most likely to leave over it.',
      howToAddress: 'Say who you asked, and what support and sales get in the meantime.',
      anchors: ["everyone I've talked to on the team wants this"],
      sources: [],
    },
    {
      id: 'ch3',
      kind: 'blind_spot',
      title: 'You deferred the hardest problem, coverage, without a plan.',
      body: 'Leadership readers will go straight to customer coverage, response-time SLAs and on-call. "Once we\'ve worked out coverage" says there is no plan yet. In the UK pilot the common answers were staggered days off and shared queues; naming one makes the deferral credible.',
      howToAddress: 'One sentence on how engineering on-call and design reviews stay covered on the fifth day.',
      anchors: ["Support and sales can follow once we've worked out coverage."],
      sources: [
        { url: 'https://autonomy.work/portfolio/uk4dwpilotresults/', title: 'UK pilot report, implementation models', publisher: 'Autonomy', date: 'Feb 2023' },
      ],
    },
    {
      id: 'ch4',
      kind: 'gap',
      title: "There's no definition of success.",
      body: 'A six-week checkpoint against what? Without metrics agreed up front (cycle time, incident rate, customer response time, an engagement survey), the result of the pilot will be argued after the fact, by whoever is most senior.',
      howToAddress: "Name two or three numbers you'd watch and what would make you stop the pilot.",
      anchors: ['with a checkpoint at six weeks'],
      sources: [],
    },
  ],
};

/** URLs the mock provider reports as "seen" in search results, so the source allowlist gate passes for the canned data. */
export const SAMPLE_SOURCES_SEEN = [
  'https://news.microsoft.com/ja-jp/2019/10/31/191031-published-the-results-of-measuring-the-effectiveness-of-our-work-life-choice-challenge-summer-2019/',
  'https://autonomy.work/portfolio/icelandsww/',
  'https://autonomy.work/portfolio/uk4dwpilotresults/',
];
