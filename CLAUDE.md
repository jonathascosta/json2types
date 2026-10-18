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
   - one that knows the development context (the task, the decisions taken, the conversation);
   - one with no context of the task at all, only expertise in the technology used, reviewing
     the diff on its own.

   Report what they find in this table:

   | Priority | Short description | Resolved | How to resolve |
   | --- | --- | --- | --- |
   | P0, P1 or P2 | … | Yes / No | … |

   After presenting the table, if any finding is still unresolved, go back to step 1.
5. **Open a pull request**, with the timings and the review table in its description. Merge it
   only if the owner has said that pull requests go in automatically; otherwise wait for the
   owner's approval on each pull request.

Priorities: **P0** breaks the product, loses data or is a security problem; **P1** is a real bug
or a clear gap in what the task asked for; **P2** is a minor issue, polish or a nit.
