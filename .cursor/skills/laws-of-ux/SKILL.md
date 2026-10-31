---
name: laws-of-ux
description: Binding UX/UI constraints drawn from the 30 principles on lawsofux.com (Jon Yablonski). Use this skill whenever you design, build, review, or modify ANY user interface — web pages, apps, dashboards, forms, onboarding, checkout flows, navigation, landing pages, admin panels, mobile screens, component libraries — even when the user never mentions UX. Also use it when asked to critique, audit, or "make it more user-friendly." It forces you to resolve which psychological laws govern the screen BEFORE writing markup, and to check the result against them afterward, instead of copying whatever AI-generated or template UI patterns come to mind first.
---

# Laws of UX — Design Constraints

Source: https://lawsofux.com (Jon Yablonski, CC BY-NC-ND 4.0). Paraphrased here as working rules.
Full per-law detail: `references/laws.md`. Read it for any law you are applying in depth.

## Why this skill exists

AI-generated UI tends to default to the same things: a hero with a gradient, three identical feature cards, a navbar with eight links, a pricing table with six tiers, a modal for everything, tiny icon buttons, decorative motion. These defaults are not wrong because they are common — they are wrong when they were chosen **without reasoning about the human using them**.

These laws describe how people actually perceive, remember, decide, and move. Treat them as **constraints on what you are allowed to propose**, not as decoration to mention afterward.

Caveat from the author himself: these are not literal laws. They are heuristics. When a law conflicts with a clear user need or research finding, say so explicitly and explain the tradeoff. Never use a law to justify a bad outcome (e.g. Miller's Law is not a license to cap every list at 7).

---

## The workflow (do these in order)

### Step 0 — Ignore your first instinct
Before designing, write down (internally) the layout you would produce by default. Then treat it as a suspect, not a starting point. Ask of every element: *who needs this, at this moment, and what happens to them if it's missing?*

### Step 1 — Understand the person and the task
Identify: who the user is, their single main goal on this screen, their device (touch vs. pointer), their expertise (first-time vs. daily user), and time pressure. If unknown, state your assumption in one line and proceed. Do not stall on questions.

### Step 2 — Resolve the governing laws
Use the routing table below to pick the laws that bind this surface. Name them explicitly in your plan, e.g.:

> Governing laws: Hick (≤5 primary nav items), Fitts (44px+ targets, primary action in thumb zone), Jakob (standard checkout pattern), Peak-End (confirmation screen), Doherty (feedback <400ms).

Never write "laws applied" without naming them and the concrete decision each one forced.

### Step 3 — Design under the constraints
Apply the rules in the "Binding rules" section. When the constraint changes your design, let it change. Do not satisfy a law cosmetically.

### Step 4 — Run the audit
Before delivering, run the checklist at the bottom. Fix failures; do not just list them. In your final message, summarize in 3–6 lines which laws shaped which decisions. Keep it plain — no jargon dumps.

---

## Routing table — surface → laws that bind it

| Surface | Laws that bind it |
|---|---|
| Navigation / menus / settings | Hick, Choice Overload, Miller, Chunking, Jakob, Serial Position, Fitts |
| Landing / marketing page | Aesthetic-Usability, Von Restorff, Selective Attention, Occam, Prägnanz, Peak-End, Cognitive Load |
| Forms / sign-up / data entry | Postel, Parkinson, Cognitive Load, Working Memory, Goal-Gradient, Proximity, Common Region, Fitts |
| Checkout / payments / conversions | Jakob, Peak-End, Goal-Gradient, Zeigarnik, Hick, Doherty, Postel |
| Onboarding / first-run | Paradox of the Active User, Hick (progressive), Goal-Gradient, Mental Model, Cognitive Load |
| Dashboards / data tables / admin | Chunking, Proximity, Similarity, Common Region, Cognitive Load, Pareto, Von Restorff, Miller |
| Pricing / comparison / selection | Choice Overload, Hick, Von Restorff, Serial Position, Chunking |
| Loading / async / progress | Doherty, Goal-Gradient, Flow, Zeigarnik |
| Mobile screens | Fitts, Hick, Jakob, Proximity, Cognitive Load, Pareto |
| Errors / empty states / confirmations | Peak-End, Postel, Flow, Mental Model |
| Search / filters / catalogs | Hick, Choice Overload, Postel, Pareto, Doherty |
| Feature planning / scope | Pareto, Occam, Tesler, Paradox of the Active User |
| Visual styling / theming | Aesthetic-Usability, Similarity, Prägnanz, Von Restorff |

When a surface is not listed, start from Cognitive Load, Jakob, Hick, and Fitts — they apply almost everywhere.

---

## Binding rules (by theme)

### A. Don't overload the person
**Cognitive Load · Working Memory · Miller · Chunking · Hick · Choice Overload · Occam**
- Remove an element unless you can say what is lost without it. Done = nothing more can be removed without hurting the function (Occam).
- Distinguish *necessary* load (the task itself) from *extraneous* load (decoration, clutter, redundant copy). Cut the second.
- Don't make people remember something from one screen to use on the next (Working Memory). Show it, carry it forward, or prefill it.
- Group related items into visibly distinct chunks with clear headings. Long strings (phone numbers, IDs, card numbers) are displayed in groups.
- Limit simultaneous options. Start with ≤5 top-level nav items as a default; justify any more. Break long tasks into steps. Highlight a recommended option instead of presenting equal-weight choices.
- When comparison is genuinely required (plans, products), enable side-by-side comparison and offer filtering/search up front. Don't dump 20 equal cards.
- Do not treat "7±2" as a hard cap or excuse; it varies per person and context.
- Don't oversimplify into vagueness (Hick): fewer choices must not mean unclear ones.

### B. Respect how people perceive structure
**Proximity · Common Region · Similarity · Uniform Connectedness · Prägnanz**
- Related things sit close; unrelated things get more space. Spacing must be *meaningful*, not uniform. Gap inside a group < gap between groups.
- Use a border or background to bound a group (Common Region). Use lines/arrows to connect things that belong in sequence (Uniform Connectedness).
- Elements that look alike are read as functionally alike. Same style = same behavior. Links and buttons must look distinct from plain text. Never style a non-interactive thing like an interactive one.
- Prefer the simplest form that communicates. Simple shapes and layouts are processed and remembered faster.
- Never rely on color alone to convey grouping or state.

### C. Match what they already know
**Jakob · Mental Model · Paradox of the Active User · Postel**
- Use established patterns for established jobs: logo top-left links home, cart icon top-right, standard form controls, familiar checkout order. Be novel only where novelty earns its keep, and say why.
- If you must change a familiar pattern, let people keep or preview the old one for a while.
- People won't read instructions. Put guidance in context: placeholders that clarify, inline hints, tooltips, empty states that teach. Avoid manual-style walls of text and mandatory tours.
- Be liberal in what you accept: tolerate varied input formats (phone with spaces/dashes, dates in several formats, extra whitespace, case), normalize it yourself, and give clear feedback on genuine boundaries. Be conservative in what you output: consistent, clean formatting.

### D. Make it physically easy
**Fitts · Doherty · Parkinson**
- Touch targets ≥ 44×44 px (≥ 48 dp on Android), with ample spacing between neighbors. Larger for primary actions; closer to where the hand or pointer already is.
- Place frequent/primary actions where they are easy to reach (e.g. bottom region on phones); keep destructive actions away from primary ones.
- Give system feedback within ~400 ms. If work takes longer: skeleton screens, optimistic UI, progress indication, or meaningful animation. A progress bar helps even if approximate.
- Don't let tasks swell: shorten forms, autofill, remember, use sensible defaults, and let the task take no longer than people expect.

### E. Guide motivation and memory
**Goal-Gradient · Zeigarnik · Peak-End · Serial Position · Von Restorff · Flow**
- Show progress. Steps indicators, "2 of 4," completion meters. People accelerate as they near the end — and starting a task with some progress shown helps them finish.
- Unfinished things are remembered: use saved drafts, "continue where you left off," visible incomplete states, in moderation and without nagging or manipulation.
- Design the **peak** and the **end** deliberately: the most intense moment (first success, error, payment) and the final moment (confirmation, goodbye, cancellation). A smooth ending can redeem a clumsy middle; a hostile ending poisons a good one. Negative moments are remembered more strongly.
- Put the most important items first and last in lists/menus; least important in the middle.
- Make the one thing that matters different (Von Restorff) — and only one thing. If three things scream, nothing stands out. Don't use emphasis for trivia.
- Support flow: match challenge to skill, give immediate feedback, remove friction and interruptions during focused tasks.

### F. Beauty and ethics
**Aesthetic-Usability · Cognitive Bias · Selective Attention · Pareto · Tesler**
- Polish matters: people forgive minor usability flaws in pleasing interfaces and perceive them as easier to use. **But** beauty can mask problems; never skip usability checks because it looks good.
- People notice what serves their goal and filter the rest ("banner blindness"). Don't bury critical info in places that look like ads or chrome.
- Focus effort on the ~20% of features/flows that serve ~80% of use. Make those excellent before polishing the long tail.
- Some complexity can't be removed (Tesler). Decide who carries it: the system or the user. Default to the system.
- Know common cognitive biases (confirmation, anchoring, etc.). Use that knowledge to **reduce** error and bias — never to trick people (no dark patterns: fake scarcity, hidden fees, confirm-shaming, sneaky defaults, hard-to-find cancel).

---

## AI-default anti-patterns to reject on sight

Reject or explicitly justify each of these:
1. A navigation bar with more than ~5–7 equal-weight items and no grouping.
2. Three/four/six identical cards with icon + heading + blurb, used to fill space rather than because the content is parallel.
3. Every button styled as primary; multiple competing calls to action on one screen.
4. Icon-only controls without labels where meaning isn't universal.
5. Tiny tap targets, tight spacing, or close destructive/primary actions.
6. Modals/popups for tasks that should be inline, or modal on top of modal.
7. Long single-page forms with every field required and no progress, grouping, or autofill.
8. Strict input validation that rejects reasonable formats ("enter phone as 5551234567").
9. Unlabeled spinners with no time feedback; silent actions with no confirmation.
10. Decorative animation, gradients, or glass effects that add load without meaning.
11. Pricing/option grids with many tiers and no recommended choice or comparison aids.
12. Reinvented standard patterns (custom scrollbars, nonstandard checkbox, hidden hamburger on desktop) with no reason.
13. Color-only status (red/green) with no text or icon.
14. Lorem-ipsum-feeling copy and generic headlines instead of task-specific language.
15. Dead-end empty states and errors that blame the user or give no next step.
16. Dense walls of text without chunking or hierarchy.

---

## Final audit checklist

Answer each briefly; fix any "no."

- **Load:** Could I delete anything without losing function? Is anything the user must memorize across screens?
- **Choices:** Is the number of simultaneous options justified? Is there a recommended or default path?
- **Grouping:** Do spacing, borders, and style reflect true relationships? Same look = same behavior?
- **Familiarity:** Are standard patterns used for standard jobs? Any novelty justified?
- **Reach:** Are targets ≥44px with spacing? Are primary actions easy to reach, destructive ones separated?
- **Speed:** Is feedback <400 ms or covered by progress/skeleton? Is there loading/empty/error state for each async view?
- **Input:** Does it accept messy but clear input and normalize it? Are error messages specific and kind?
- **Progress:** Does the user know where they are and how much is left? Can they resume?
- **Emotion:** Is the peak moment and the final moment designed on purpose?
- **Emphasis:** Is exactly one primary thing emphasized per view?
- **Beauty:** Is it visually polished — and has that polish not replaced usability thinking?
- **Ethics:** Any dark patterns or manipulative bias exploitation? Remove.
- **Accessibility:** Not color-only; sufficient contrast; keyboard/screen-reader operable. (Complements these laws; never trade it away.)

## Output expectations

When producing UI: include a short "Design rationale" at the end (3–6 lines) naming the laws that drove concrete decisions, e.g. "Checkout shows a 3-step indicator (Goal-Gradient) and a warm confirmation page (Peak-End)". When reviewing existing UI: list violations by severity, name the law, state the specific fix. Be direct; don't flatter the existing design.

## Attribution

Content paraphrased from lawsofux.com by Jon Yablonski. Direct readers to the site and to the book *Laws of UX* (O'Reilly) for the full material.
