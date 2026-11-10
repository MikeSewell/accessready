# Security

If you find a security problem in focuswalk, please don't open a public issue. Report it privately through GitHub: go to the [Security tab](https://github.com/MikeSewell/focuswalk/security/advisories/new) and choose "Report a vulnerability".

You should hear back within a week.

## What to know when running it

- focuswalk opens the URLs you give it in a real browser and runs the pages' own scripts, the same as visiting them. Only audit sites you trust or own.
- A `--storage-state` file holds live session cookies. Keep it out of version control and delete it when you are done.
- The HTML and JSON reports include snippets of the audited pages' HTML. On logged-in pages that can include personal data, so treat the reports accordingly.
