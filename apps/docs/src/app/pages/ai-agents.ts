import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AGENT_SESSION } from '../agent-session';
import { SKILL_DOWNLOAD_BASE, SKILL_FILES } from '../skill-files';

/**
 * AI agents (epic developer experience 10.4): the TaleArt agent skill, which teaches Claude Code and
 * other Agent Skills agents to manage TaleArt through the `taleart` CLI. What it does, its safety
 * rules, how to install it and give it a token, an example session, and the skill's text.
 */
@Component({
  selector: 'docs-ai-agents',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .session {
      list-style: none;
      padding: 0;
    }
    .session > li {
      margin: 0 0 1rem;
    }
    .session__who {
      font-weight: 600;
    }
    .downloads li {
      margin-bottom: 0.25rem;
    }
    details {
      margin: 0.75rem 0;
    }
    summary {
      cursor: pointer;
      font-weight: 600;
    }
    summary:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
  `,
  template: `
    <h1 tabindex="-1">AI agents</h1>
    <p class="lede">
      The TaleArt skill teaches an AI agent, such as Claude Code, to manage your zones, tale groups, tales and targeting
      with the <code>taleart</code> command-line tool, and tells it how to handle your API token.
    </p>

    <h2 id="what-the-skill-does">What the skill does</h2>
    <ul>
      <li>
        Gives the agent the TaleArt words (project, zone, display, tale group, tale, site key, tags, user lists, Visible
        on site) and the rule that decides when a zone shows a group.
      </li>
      <li>
        Gives it recipes with exact commands: a zone with a bar and its install snippet, a tale group of image tales
        turned On, targeting by tags and by user lists, why something is not visible, copying a group to another zone,
        rotating a site key.
      </li>
      <li>
        Makes it work the way scripts should: <code>--json</code> on every command, errors read by exit code, commands
        discovered with <code>taleart help commands --json</code> instead of guessed.
      </li>
      <li>Has it report what changed: names, ids, On or Off, and whether each thing is visible on site.</li>
    </ul>

    <h2 id="safety-rules">Safety rules</h2>
    <p>The skill tells the agent to:</p>
    <ul>
      <li>
        <strong>Never print, echo, log or store your token</strong>, never pass it on the command line, and never ask
        you to paste it into the chat. The CLI shows only its prefix (<code>tat_</code> and 6 characters).
      </li>
      <li>
        Never run commands that print the environment (<code>env</code>, <code>printenv</code>, <code>set</code>),
        never read the CLI's config file or a token file, and check access only with
        <code>taleart whoami --json</code> or <code>taleart config show --json</code>.
      </li>
      <li>
        <strong>Ask before anything destructive</strong>: rotating or revoking the site key, deleting a tale or a user
        list, changing a zone's slug. It adds <code>--yes</code> only after you agree; without it the CLI refuses
        (exit 10) and changes nothing.
      </li>
      <li>Use a read-only token, or only read commands, for tasks that only read.</li>
      <li>
        Also ask before changes the CLI does not call destructive but you may not expect: clearing a group's tags or
        user lists, turning a group On where the zone is already installed, replacing a tale's media, changing the
        default project.
      </li>
      <li>Run no more commands than the task needs, and stop and ask you after two failed tries at the same step.</li>
      <li>
        Keep external user IDs out of URLs, commands and its replies: they go only into the CSV file you give it,
        which it never reads (it asks you whether the first row is a header), and TaleArt keeps only keyed hashes of
        them.
      </li>
      <li>Hand you a new site key once, and never write it to a file unless you ask.</li>
    </ul>
    <aside class="callout callout--warning">
      <p>
        <strong>These are instructions to the agent, not a lock.</strong> The agent runs with your environment and
        your files, so it can reach the token it uses: the skill tells it not to look, but nothing stops it. The real
        limits are the token's: its projects, read-only or not, its expiry, and your role.
      </p>
      <p>
        Give an agent the narrowest <a routerLink="/api-tokens">API token</a> that does the job, with an expiry, and
        revoke it when you are done.
      </p>
    </aside>

    <h2 id="install-it">Install it</h2>
    <p>With the <code>taleart</code> command-line tool, in one line:</p>
    <pre
      tabindex="0"
      role="region"
      aria-label="Install the skill with the CLI"
    ><code>taleart skill install            # for you: ~/.claude/skills/taleart
taleart skill install --project  # for one repository: .claude/skills/taleart
taleart skill install --dir ~/.agents/skills   # another agent's skills folder</code></pre>
    <p>
      The CLI carries the skill, so this works without the TaleArt repository. If the folder already holds a different
      version, it stops (exit 6); add <code>--force</code> to replace the skill's files. Start a new agent session
      afterwards so the agent loads it.
    </p>
    <p>
      Or copy the folder by hand: the <code>skills/taleart</code> folder of the TaleArt repository, or the files below,
      to <code>~/.claude/skills/taleart</code> (for you) or <code>.claude/skills/taleart</code> (for one repository):
    </p>
    <pre tabindex="0" role="region" aria-label="Install the skill by copying the folder"><code>mkdir -p ~/.claude/skills
cp -R skills/taleart ~/.claude/skills/taleart</code></pre>
    <p>
      No <code>taleart</code> on your PATH yet? In the TaleArt repository, <code>node_modules/.bin/nx run cli:build</code>
      builds it to <code>dist/apps/cli/taleart.js</code> (Node 22 or later).
    </p>

    <h2 id="give-it-a-token">Give it a token</h2>
    <ol class="steps">
      <li>
        Create an <a routerLink="/api-tokens">API token</a> in the dashboard (Settings &gt; API tokens): only the
        projects the agent needs, and read-only unless it must change things.
      </li>
      <li>
        In your own terminal, before you start the agent, put the API URL and the token in the environment. Type or
        paste the token there, never into the agent's chat:
      </li>
    </ol>
    <pre tabindex="0" role="region" aria-label="Set the API URL and the token"><code>export TALEART_API_URL=https://your-taleart-api
read -rs TALEART_TOKEN &amp;&amp; export TALEART_TOKEN   # paste the token; it is not shown</code></pre>
    <p>
      Or store them in the CLI's config file (mode 0600) with
      <code>taleart login --url https://your-taleart-api --token-stdin &lt; token.txt</code>, then delete
      <code>token.txt</code>. The agent checks access with <code>taleart whoami --json</code>, which shows the token's
      prefix, never the token.
    </p>

    <h2 id="an-example-session">An example session</h2>
    <p>
      The skill's main recipe, run through the CLI against a test API (answers shortened; the site key is redacted,
      and the token never appears):
    </p>
    <ol class="session">
      @for (turn of session; track $index) {
        <li>
          <p>
            <span class="session__who">{{ turn.who === 'user' ? 'You' : 'Agent' }}:</span> {{ turn.text }}
          </p>
          @if (turn.shell) {
            <pre tabindex="0" role="region" [attr.aria-label]="'Commands the agent ran, step ' + ($index + 1)"><code>{{ turn.shell }}</code></pre>
          }
        </li>
      }
    </ol>

    <h2 id="the-skill">The skill</h2>
    <p>
      <code>SKILL.md</code> holds what an agent reads first; it points to the reference files for the rest. Download
      each file, or read it here.
    </p>
    <ul class="downloads">
      @for (file of files; track file.path) {
        <li>
          <a [href]="downloadBase + file.path" [attr.download]="file.path.split('/').pop()">{{ file.path }}</a>:
          {{ file.about }}
        </li>
      }
    </ul>
    @for (file of files; track file.path; let first = $first) {
      <details [open]="first">
        <summary>{{ file.path }}</summary>
        <pre tabindex="0" role="region" [attr.aria-label]="'The skill file ' + file.path"><code>{{ file.content }}</code></pre>
      </details>
    }
  `,
})
export class AiAgentsPage {
  protected readonly session = AGENT_SESSION;
  protected readonly files = SKILL_FILES;
  protected readonly downloadBase = SKILL_DOWNLOAD_BASE;
}
