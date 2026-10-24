// The "AI agents" page's example session (epic developer experience 10.4): the story's verify task
// done by following the TaleArt skill through the CLI against a test API. Taken from the verify run,
// shortened (JSON trimmed to the fields the agent reads, the API URL replaced by api.example.com),
// with the site key redacted; the token never appears, only its prefix.
// apps/cli/src/skill.spec.ts parses every `$ taleart` line here with the CLI's own parser.

export interface SessionTurn {
  who: 'user' | 'agent';
  /** What was said. */
  text: string;
  /** The commands the agent ran next and what they answered (trimmed), if any. */
  shell?: string;
}

export const AGENT_SESSION: readonly SessionTurn[] = [
  {
    who: 'user',
    text: 'Create a zone home-top with a bar and a group Summer with two tales from ./img, and turn it On.',
  },
  {
    who: 'agent',
    text: 'I will use the TaleArt skill. First, checking access and the commands I will need.',
    shell: String.raw`$ taleart whoami --json
{ "tokenPrefix": "tat_7OCJsd", "tokenSource": "env", "readOnly": false, "allProjects": true,
  "user": { "name": "Dana", "role": "admin" },
  "projects": [{ "id": "453572e6-…", "name": "Shop" }], "defaultProject": null }

$ taleart help commands --json
{ "commands": [ … { "command": "zones create", "mutates": true, "destructive": false, … } … ] }`,
  },
  {
    who: 'agent',
    text: 'The token reaches one project, Shop, so I pass --project "Shop" on every command. Creating the zone, its bar, the group and one tale per image.',
    shell: String.raw`$ taleart zones create --name "Home top" --slug home-top --project "Shop" --json
{ "id": "b950ac31-…", "slug": "home-top", "frame": null,
  "visibility": { "visible": false, "reasons": [{ "code": "zone-no-display" }, { "code": "zone-not-installed" }, { "code": "no-tale-groups" }] } }

$ taleart zones display home-top --type bar --project "Shop" --json
{ "type": "bar", "settings": { "gap": 12, "size": "medium", "shape": "circle", "alignment": "start", "showTitles": true } }

$ ls ./img
ocean.png  sunrise.png

$ taleart groups create --name Summer --zone home-top --project "Shop" --json
{ "id": "985385d5-…", "name": "Summer", "status": "draft", "position": 0, "zoneIds": ["b950ac31-…"] }

$ taleart tales create --group Summer ./img/sunrise.png ./img/ocean.png --project "Shop" --json
[ { "id": "f536ba70-…", "title": "sunrise", "storedStatus": "live", "media": { "contentType": "image/png" } },
  { "id": "222121a4-…", "title": "ocean", "storedStatus": "live", "media": { "contentType": "image/png" } } ]

$ taleart groups on Summer --project "Shop" --json
{ "name": "Summer", "status": "live",
  "visibility": { "visible": false, "reasons": [{ "code": "zone-not-installed", "subject": "zone" }] } }

$ taleart site-keys get --project "Shop" --json
null`,
  },
  {
    who: 'agent',
    text:
      'Summer is On in home-top, but it is not visible yet: the project has no site key (zone-not-installed). ' +
      'A site key is issued once per project and shown only once. Shall I issue it?',
  },
  { who: 'user', text: 'Yes, issue it.' },
  {
    who: 'agent',
    text: 'Issuing it, then checking again and getting the snippet.',
    shell: String.raw`$ taleart site-keys issue --project "Shop" --json
{ "key": "tas_oRYmcH…[REDACTED]", "prefix": "tas_oRYmcH", "createdAt": "2026-10-24T05:46:41.164Z" }

$ taleart groups get Summer --project "Shop" --json
{ "name": "Summer", "status": "live", "tales": [ …2 tales… ], "visibility": { "visible": true, "reasons": [] } }

$ taleart zones snippet home-top --site-key "tas_oRYmcH…[REDACTED]" --project "Shop" --json
{ "snippet": "<script type=\"module\" src=\"https://api.example.com/sdk/v1/taleart.js\"></script>\n<taleart-view api-url=\"https://api.example.com\" site-key=\"tas_oRYmcH…[REDACTED]\" zone=\"home-top\"></taleart-view>",
  "testPageUrl": "https://api.example.com/sdk/v1/test-page?zone=home-top#siteKey=tas_oRYmcH…[REDACTED]" }`,
  },
  {
    who: 'agent',
    text:
      'Done. Created the zone Home top (home-top) with a bar display, and the tale group Summer in it with two Shown tales, ' +
      'sunrise and ocean; Summer is On and visible on site. I issued the project\'s site key (prefix tas_oRYmcH): it is shown ' +
      'above once, keep it; I did not save it anywhere. Put the snippet on your page, or open the test page link to see the zone now.',
  },
];
