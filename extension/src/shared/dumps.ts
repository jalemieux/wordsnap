// Real stream-of-consciousness drafts: the gate runs Shape on them, the playground offers them, the mock answers the first.
export const AGENTS_DUMP = [
  'ok so the idea came from that story about agents coordinating on their own, wanted to see if a few claude sessions could organize themselves without me micromanaging. not sure it would work honestly, maybe they need a lot of structure to get anywhere. actually no i think less structure is the point.',
  'i was careful no to enforce toop much structure in the harness or in prompts (link to podcast from darkesh)_, actually did very little and simply instructed the bot to go fetch the latest instructions from the board whenever they start.',
  'These instruction were amde availabel on the board, so the bot would only need a refrence to the board /agents.md file and would not need anymore details. the agents.md could be changed as neede don the board, as the board eveolved.',
  'The first iteration was a very simple board with very simple inprompt to bot, instructing them to introudce themselve and look up the board every now and then. Then i had them work on a siomple git history cleaning task. I immediatly notice how the bot would pick work and delegate and eventually orgnzie and break downt he worl.',
  'with hthse encouraging results, i improve the board to be more reactive, where bopts would be notified when a message direct or in channel would be poseted. or that another bot would tag tham, and ended up with a board that is much like a simple version of slack, with webstockets to ensure prompt notification.',
  'then set off to have them work on on a side project of my (wordsnap.ai).',
].join('\n\n');

export const OFFSITE_DUMP = [
  'hey all so about the offsite, i know we said may but honestly may is bad, half the team is out for the conference on the 14th and budget resets in june anyway',
  'so thinking we push to june? or actually maybe keep may but do it remote, no thats worse, in person matters for this one. june it is',
  'need someone to own the venue, last time dana did it and it was great but shes on leave. also food, we went over by like 30% last time bc nobody tracked headcount',
  'agenda wise i want one day on the roadmap and one day just people hanging out, not more workshops, everyone hated the workshops',
  'can people reply by friday with dates that dont work',
].join('\n\n');

export const HIRING_DUMP = [
  'hired 6 engineers this year and the thing i got most wrong was thinking the take home test told me anything. it told me who had a free weekend',
  'what worked better was pairing for an hour on a real bug from our backlog, you see how they think, how they ask questions, whether they say i dont know',
  'also references, i used to skip them, big mistake, the one hire that didnt work out had a reference who basically warned me and i didnt call',
  'not saying take homes are useless for everyone, some people like them. but for us, small team, no. pairing plus references',
  'and write the job post like a person, people applied because the post said what the work actually was',
].join('\n\n');

export const DUMPS: { id: string; label: string; text: string }[] = [
  { id: 'agents', label: 'Agents on a board (post)', text: AGENTS_DUMP },
  { id: 'offsite', label: 'Offsite dates (email)', text: OFFSITE_DUMP },
  { id: 'hiring', label: 'Hiring lessons (post)', text: HIRING_DUMP },
];
