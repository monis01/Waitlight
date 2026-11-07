// Writes pretend sessions so we can see the UI without running Claude.
//   npm run fake        -> write 4 sessions, one in each state
//   npm run fake:live   -> same, then keep changing one state every 12 seconds (Ctrl+C to stop)
//   npm run fake -- --clear  -> delete all fake sessions
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '.dev-sessions');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const now = Date.now();

// "minsAgo" values make the times look realistic: "waiting 4m", "done 12m ago", etc.
const sessions = [
  {
    sessionId: 'aaaa1111-fake', state: 'needsYou', cwd: '/projects/webapp',
    title: 'Fix login redirect bug', stateSince: now - 4 * MIN,
    prompts: [
      { text: 'why does /login loop after I sign in? It keeps redirecting back to /login even though the cookie is set and the session looks valid in the network tab.', at: now - 35 * MIN },
      { text: 'ok try the cookie fix', at: now - 20 * MIN },
      { text: 'run the tests again', at: now - 5 * MIN },
    ],
  },
  {
    sessionId: 'bbbb2222-fake', state: 'working', cwd: '/projects/webapp',
    title: 'Add CSV export', stateSince: now - 2 * MIN,
    prompts: [{ text: 'add a CSV export button to the reports page', at: now - 2 * MIN }],
  },
  {
    sessionId: 'cccc3333-fake', state: 'done', cwd: path.join(__dirname, '..'), // this repo, so the folder filter shows it
    title: 'Refactor sessionStore', stateSince: now - 12 * MIN,
    prompts: [
      { text: 'split the store into smaller functions', at: now - 40 * MIN },
      { text: 'add comments', at: now - 15 * MIN },
    ],
  },
  {
    sessionId: 'dddd4444-fake', state: 'done', cwd: '/projects/notes', stateSince: now - 26 * HOUR,
    title: 'Old README chat', updatedAt: now - 26 * HOUR, // old -> shows Idle, "yesterday"
    prompts: [{ text: 'tidy up the README', at: now - 27 * HOUR }],
  },
];

// Write to a temp file and rename it, so the extension never reads half a file.
function write(s) {
  const data = {
    agent: 'claude',
    updatedAt: Date.now(),
    ...s,
    lastPrompt: s.prompts.at(-1).text,
  };
  const file = path.join(dir, `${s.sessionId}.json`);
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2));
  fs.renameSync(file + '.tmp', file);
}

if (process.argv.includes('--clear')) {
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('Cleared', dir);
  process.exit(0);
}

fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
sessions.forEach(write);
console.log(`Wrote ${sessions.length} fake sessions to ${dir}`);

if (process.argv.includes('--live')) {
  const cycle = ['working', 'needsYou', 'working', 'done'];
  let step = 0;
  console.log('Changing one session every 12s. Ctrl+C to stop.');
  setInterval(() => {
    const s = sessions[step % 3];
    s.state = cycle[(cycle.indexOf(s.state) + 1) % cycle.length];
    s.stateSince = Date.now(); // a new state starts now
    step++;
    sessions.slice(0, 3).forEach(write); // refresh updatedAt so they don't go Idle
    console.log(sessions.slice(0, 3).map((x) => `${x.title}: ${x.state}`).join(' | '));
  }, 12000);
}
