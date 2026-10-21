# Repository rules

## Writing style

**Do not use em dashes (`—`) in any file in this repository.** This covers READMEs,
demo documentation, YAML comments, commit messages and PR descriptions.

Use a comma, a colon, parentheses, or split the sentence in two instead:

| Instead of | Write |
|:---|:---|
| `BGP gets the prefixes into the VPC — nothing else follows` | `BGP gets the prefixes into the VPC. Nothing else follows.` |
| `two IPs — one routable, one locked` | `two IPs: one routable, one locked` |
| `the operator creates it — named cluster-udn-<name>` | `the operator creates it (named cluster-udn-<name>)` |

**Why:** demos from this repo get ported to the team documentation site at
<https://cloud.redhat.com/experts/> ([rh-mobb/documentation](https://github.com/rh-mobb/documentation)),
which bans em dashes in site content. Keeping the two in sync removes a whole
class of rewriting from every port.

En dashes (`–`) and hyphens (`-`) are fine.
