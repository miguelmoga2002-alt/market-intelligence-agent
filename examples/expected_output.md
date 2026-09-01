# Example runs

What a session looks like against the local model. (Figures come from the fictional
sample data in `src/db/queries.js`.)

---

**A single-model price question** routes to one `median_price` call:

```
$ node examples/ask.js "what's the RTX 4070 going for?"
Q: what's the RTX 4070 going for?

Tools used:
  - median_price {"query":"RTX 4070"}

A: The RTX 4070 has a median price of about 575 (6 samples), ranging from 520 to 560
   on the available listings. Prices are similar across platforms.
```

---

**A comparison** makes the model call `median_price` once per model, then summarize -
this is the behaviour the system prompt enforces:

```
$ node examples/ask.js "compare the RTX 4070 and the 4070 Ti"
Q: compare the RTX 4070 and the 4070 Ti

Tools used:
  - median_price {"query":"RTX 4070"}
  - median_price {"query":"RTX 4070 Ti"}

A: The RTX 4070 sits around a 575 median, the 4070 Ti around 600. The Ti is the pricier
   of the two on current listings.
```

---

**Validation in action.** If the model proposes a value outside the whitelist, it is
dropped before it reaches the query, and the run records a warning:

```
Tools used:
  - median_price {"query":"RTX 4070","limit":50}

Validation warnings:
  - dropped vertical='INVENTED' (not in whitelist [pc, bike, machinery, laptop])
```

The model never writes SQL; it only chooses a tool and arguments, and the arguments are
validated before anything runs.
