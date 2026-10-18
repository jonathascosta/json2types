# json2types

Paste JSON, get types. A static web tool at json2types.jonathas.net that turns a JSON sample into
C# and TypeScript types, entirely in the browser. One site, one path per target language
(`/csharp`, `/typescript`), each with its own options.

## Workflow for every task

Follow these steps for each task, in order. They apply to this project and to any future project
of the owner's.

1. **Start the timers.** Time each stage (development, test, review) and the task as a whole,
   from its start until its pull request is opened. Record UTC timestamps at every stage change
   (`date -u +%FT%TZ`) and report the durations in the pull request.
2. **Develop.**
3. **Test.** If anything goes wrong, go back to step 1: a new development round, timed again.
4. **Review** with two independent agents:
   - **Atlas** knows the business and the task: the development context, the decisions taken, the
     conversation;
   - **Spock** knows nothing of the business or the task, only the technology used, and reviews
     the diff on its own.

   Report what they find in this table:

   | Priority | Short description | Resolved | How to resolve |
   | -------- | ----------------- | -------- | -------------- |
   | P0 to P4 | …                 | Yes / No | …              |

   After presenting the table, if any P0, P1 or P2 finding is still unresolved, go back to step 1.
   P3 and P4 findings that don't matter yet may instead be recorded as issues for later (the table
   links the issue) without another round.

5. **Open a pull request**, with the timings and the review table in its description. Merge it
   only if the owner has said that pull requests go in automatically; otherwise wait for the
   owner's approval on each pull request.

Priorities: **P0** breaks the product, loses data or is a security problem; **P1** is a real bug
or a clear gap in what the task asked for; **P2** is a minor issue that is worth fixing now;
**P3** is an improvement that can wait; **P4** is an idea or a nit with little value today. The scale
doesn't stop the reviewers: they report everything they find, at whatever level fits.
