package site.lempert.taleart.sdk.targeting

// The audience rule's shared test table, copied from libs/contract/targeting/audience-rule.cases.json
// (the TypeScript contract's table, which every SDK runs). AudienceRuleCasesSyncTest, on the Android host,
// reads the contract's file and fails when this copy differs: change both together.
internal val AUDIENCE_RULE_CASES_JSON = """
{
  "${'$'}comment": "The audience rule's test table (epic viewer properties). Every SDK runs it: the TypeScript contract and the native SDK. A case holds when audienceRulePasses(rule, properties) equals passes, where rule null means the group has no audience rule and properties null means the page passed no viewer properties. Properties are normalised first (invalid entries dropped), as viewerPropertiesFrom does. Strings compare after Unicode NFC, trimming and a locale-independent lower case.",
  "cases": [
    {
      "name": "no rule, no properties",
      "rule": null,
      "properties": null,
      "passes": true
    },
    {
      "name": "no rule, empty properties",
      "rule": null,
      "properties": {},
      "passes": true
    },
    {
      "name": "empty conditions, properties set",
      "rule": {
        "match": "all",
        "conditions": []
      },
      "properties": {
        "plan": "pro"
      },
      "passes": true
    },
    {
      "name": "rule set, properties never passed (null), eq",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "eq",
            "value": "pro"
          }
        ]
      },
      "properties": null,
      "passes": true
    },
    {
      "name": "rule set, properties never passed (null), notExists",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "notExists"
          }
        ]
      },
      "properties": null,
      "passes": true
    },
    {
      "name": "rule set, properties never passed (null), exists",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "exists"
          }
        ]
      },
      "properties": null,
      "passes": true
    },
    {
      "name": "rule set, properties never passed (null), gt",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "age",
            "operator": "gt",
            "value": 30
          }
        ]
      },
      "properties": null,
      "passes": true
    },
    {
      "name": "rule set, properties never passed (null), any",
      "rule": {
        "match": "any",
        "conditions": [
          {
            "property": "plan",
            "operator": "eq",
            "value": "pro"
          }
        ]
      },
      "properties": null,
      "passes": true
    },
    {
      "name": "empty properties, eq fails",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "eq",
            "value": "pro"
          }
        ]
      },
      "properties": {},
      "passes": false
    },
    {
      "name": "empty properties, neq passes (missing)",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "neq",
            "value": "pro"
          }
        ]
      },
      "properties": {},
      "passes": true
    },
    {
      "name": "empty properties, notIn passes (missing)",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "notIn",
            "value": [
              "pro"
            ]
          }
        ]
      },
      "properties": {},
      "passes": true
    },
    {
      "name": "empty properties, notExists passes",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "notExists"
          }
        ]
      },
      "properties": {},
      "passes": true
    },
    {
      "name": "empty properties, exists fails",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "exists"
          }
        ]
      },
      "properties": {},
      "passes": false
    },
    {
      "name": "empty properties, gt fails",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "age",
            "operator": "gt",
            "value": 1
          }
        ]
      },
      "properties": {},
      "passes": false
    },
    {
      "name": "empty properties, lte fails",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "age",
            "operator": "lte",
            "value": 100
          }
        ]
      },
      "properties": {},
      "passes": false
    },
    {
      "name": "empty properties, in fails",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "in",
            "value": [
              "pro"
            ]
          }
        ]
      },
      "properties": {},
      "passes": false
    },
    {
      "name": "empty properties, contains fails",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "contains",
            "value": "pr"
          }
        ]
      },
      "properties": {},
      "passes": false
    },
    {
      "name": "eq string equal",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "eq",
            "value": "pro"
          }
        ]
      },
      "properties": {
        "plan": "pro"
      },
      "passes": true
    },
    {
      "name": "eq string ignores case",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "eq",
            "value": "pro"
          }
        ]
      },
      "properties": {
        "plan": "PRO"
      },
      "passes": true
    },
    {
      "name": "eq string ignores surrounding spaces",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "eq",
            "value": "pro"
          }
        ]
      },
      "properties": {
        "plan": "  pro "
      },
      "passes": true
    },
    {
      "name": "eq string NFC rule matches NFD viewer",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "city",
            "operator": "eq",
            "value": "café"
          }
        ]
      },
      "properties": {
        "city": "café"
      },
      "passes": true
    },
    {
      "name": "eq string different",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "eq",
            "value": "pro"
          }
        ]
      },
      "properties": {
        "plan": "free"
      },
      "passes": false
    },
    {
      "name": "eq string is not accent-folded",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "city",
            "operator": "eq",
            "value": "cafe"
          }
        ]
      },
      "properties": {
        "city": "café"
      },
      "passes": false
    },
    {
      "name": "eq string Turkish dotted capital I is not plain i",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "city",
            "operator": "eq",
            "value": "istanbul"
          }
        ]
      },
      "properties": {
        "city": "İstanbul"
      },
      "passes": false
    },
    {
      "name": "eq number equal",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "age",
            "operator": "eq",
            "value": 30
          }
        ]
      },
      "properties": {
        "age": 30
      },
      "passes": true
    },
    {
      "name": "eq number different",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "age",
            "operator": "eq",
            "value": 30
          }
        ]
      },
      "properties": {
        "age": 31
      },
      "passes": false
    },
    {
      "name": "eq number against numeric string is a type mismatch",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "age",
            "operator": "eq",
            "value": 30
          }
        ]
      },
      "properties": {
        "age": "30"
      },
      "passes": false
    },
    {
      "name": "eq string value against number viewer is a type mismatch",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "age",
            "operator": "eq",
            "value": "30"
          }
        ]
      },
      "properties": {
        "age": 30
      },
      "passes": false
    },
    {
      "name": "eq boolean equal",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "beta",
            "operator": "eq",
            "value": true
          }
        ]
      },
      "properties": {
        "beta": true
      },
      "passes": true
    },
    {
      "name": "eq boolean against string is a type mismatch",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "beta",
            "operator": "eq",
            "value": true
          }
        ]
      },
      "properties": {
        "beta": "true"
      },
      "passes": false
    },
    {
      "name": "eq boolean false is not number zero",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "beta",
            "operator": "eq",
            "value": false
          }
        ]
      },
      "properties": {
        "beta": 0
      },
      "passes": false
    },
    {
      "name": "eq decimal number",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "score",
            "operator": "eq",
            "value": 1.5
          }
        ]
      },
      "properties": {
        "score": 1.5
      },
      "passes": true
    },
    {
      "name": "eq empty string value matches empty viewer string",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "nick",
            "operator": "eq",
            "value": ""
          }
        ]
      },
      "properties": {
        "nick": ""
      },
      "passes": true
    },
    {
      "name": "eq against list viewer is a type mismatch",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "tags",
            "operator": "eq",
            "value": "a"
          }
        ]
      },
      "properties": {
        "tags": [
          "a"
        ]
      },
      "passes": false
    },
    {
      "name": "neq string different passes",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "neq",
            "value": "pro"
          }
        ]
      },
      "properties": {
        "plan": "free"
      },
      "passes": true
    },
    {
      "name": "neq string equal fails",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "neq",
            "value": "pro"
          }
        ]
      },
      "properties": {
        "plan": "PRO"
      },
      "passes": false
    },
    {
      "name": "neq number against string is a type mismatch",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "age",
            "operator": "neq",
            "value": 30
          }
        ]
      },
      "properties": {
        "age": "30"
      },
      "passes": false
    },
    {
      "name": "neq boolean different passes",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "beta",
            "operator": "neq",
            "value": true
          }
        ]
      },
      "properties": {
        "beta": false
      },
      "passes": true
    },
    {
      "name": "neq against list viewer is a type mismatch",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "tags",
            "operator": "neq",
            "value": "a"
          }
        ]
      },
      "properties": {
        "tags": [
          "b"
        ]
      },
      "passes": false
    },
    {
      "name": "in list contains viewer string",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "in",
            "value": [
              "pro",
              "plus"
            ]
          }
        ]
      },
      "properties": {
        "plan": "plus"
      },
      "passes": true
    },
    {
      "name": "in ignores case",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "in",
            "value": [
              "pro",
              "plus"
            ]
          }
        ]
      },
      "properties": {
        "plan": "PRO"
      },
      "passes": true
    },
    {
      "name": "in no match",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "in",
            "value": [
              "pro",
              "plus"
            ]
          }
        ]
      },
      "properties": {
        "plan": "free"
      },
      "passes": false
    },
    {
      "name": "in with a number viewer is a type mismatch",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "in",
            "value": [
              "1",
              "2"
            ]
          }
        ]
      },
      "properties": {
        "plan": 1
      },
      "passes": false
    },
    {
      "name": "in with a boolean viewer is a type mismatch",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "beta",
            "operator": "in",
            "value": [
              "true"
            ]
          }
        ]
      },
      "properties": {
        "beta": true
      },
      "passes": false
    },
    {
      "name": "in with a list viewer is a type mismatch",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "tags",
            "operator": "in",
            "value": [
              "a"
            ]
          }
        ]
      },
      "properties": {
        "tags": [
          "a"
        ]
      },
      "passes": false
    },
    {
      "name": "notIn viewer not listed passes",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "notIn",
            "value": [
              "pro",
              "plus"
            ]
          }
        ]
      },
      "properties": {
        "plan": "free"
      },
      "passes": true
    },
    {
      "name": "notIn viewer listed fails",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "notIn",
            "value": [
              "pro",
              "plus"
            ]
          }
        ]
      },
      "properties": {
        "plan": "Plus"
      },
      "passes": false
    },
    {
      "name": "notIn missing property passes",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "notIn",
            "value": [
              "pro"
            ]
          }
        ]
      },
      "properties": {
        "age": 3
      },
      "passes": true
    },
    {
      "name": "notIn with a number viewer is a type mismatch",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "age",
            "operator": "notIn",
            "value": [
              "30"
            ]
          }
        ]
      },
      "properties": {
        "age": 30
      },
      "passes": false
    },
    {
      "name": "gt greater passes",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "age",
            "operator": "gt",
            "value": 30
          }
        ]
      },
      "properties": {
        "age": 31
      },
      "passes": true
    },
    {
      "name": "gt equal fails",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "age",
            "operator": "gt",
            "value": 30
          }
        ]
      },
      "properties": {
        "age": 30
      },
      "passes": false
    },
    {
      "name": "gte equal passes",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "age",
            "operator": "gte",
            "value": 30
          }
        ]
      },
      "properties": {
        "age": 30
      },
      "passes": true
    },
    {
      "name": "gte less fails",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "age",
            "operator": "gte",
            "value": 30
          }
        ]
      },
      "properties": {
        "age": 29
      },
      "passes": false
    },
    {
      "name": "lt less passes",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "age",
            "operator": "lt",
            "value": 30
          }
        ]
      },
      "properties": {
        "age": 29
      },
      "passes": true
    },
    {
      "name": "lt equal fails",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "age",
            "operator": "lt",
            "value": 30
          }
        ]
      },
      "properties": {
        "age": 30
      },
      "passes": false
    },
    {
      "name": "lte equal passes",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "age",
            "operator": "lte",
            "value": 30
          }
        ]
      },
      "properties": {
        "age": 30
      },
      "passes": true
    },
    {
      "name": "lte greater fails",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "age",
            "operator": "lte",
            "value": 30
          }
        ]
      },
      "properties": {
        "age": 31
      },
      "passes": false
    },
    {
      "name": "gt on a string viewer is a type mismatch",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "age",
            "operator": "gt",
            "value": 30
          }
        ]
      },
      "properties": {
        "age": "31"
      },
      "passes": false
    },
    {
      "name": "gt with a string value is a type mismatch",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "age",
            "operator": "gt",
            "value": "30"
          }
        ]
      },
      "properties": {
        "age": 31
      },
      "passes": false
    },
    {
      "name": "gt on a boolean viewer is a type mismatch",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "beta",
            "operator": "gt",
            "value": 0
          }
        ]
      },
      "properties": {
        "beta": true
      },
      "passes": false
    },
    {
      "name": "gt with negative numbers",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "delta",
            "operator": "gt",
            "value": -1
          }
        ]
      },
      "properties": {
        "delta": 0
      },
      "passes": true
    },
    {
      "name": "lte with decimals equal",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "score",
            "operator": "lte",
            "value": 2.5
          }
        ]
      },
      "properties": {
        "score": 2.5
      },
      "passes": true
    },
    {
      "name": "gte on a list viewer is a type mismatch",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "tags",
            "operator": "gte",
            "value": 1
          }
        ]
      },
      "properties": {
        "tags": [
          "1",
          "2"
        ]
      },
      "passes": false
    },
    {
      "name": "contains substring of a string",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "season",
            "operator": "contains",
            "value": "mer"
          }
        ]
      },
      "properties": {
        "season": "summer"
      },
      "passes": true
    },
    {
      "name": "contains ignores case of both sides",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "title",
            "operator": "contains",
            "value": "SALE"
          }
        ]
      },
      "properties": {
        "title": "Summer Sale"
      },
      "passes": true
    },
    {
      "name": "contains substring not found",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "title",
            "operator": "contains",
            "value": "winter"
          }
        ]
      },
      "properties": {
        "title": "Summer Sale"
      },
      "passes": false
    },
    {
      "name": "contains list item equal ignoring case",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "tags",
            "operator": "contains",
            "value": "VIP"
          }
        ]
      },
      "properties": {
        "tags": [
          "vip",
          "beta"
        ]
      },
      "passes": true
    },
    {
      "name": "contains list item only a substring fails",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "tags",
            "operator": "contains",
            "value": "vip"
          }
        ]
      },
      "properties": {
        "tags": [
          "vipper"
        ]
      },
      "passes": false
    },
    {
      "name": "contains with a number viewer fails",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "age",
            "operator": "contains",
            "value": "3"
          }
        ]
      },
      "properties": {
        "age": 30
      },
      "passes": false
    },
    {
      "name": "contains matches NFD list item with NFC value",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "tags",
            "operator": "contains",
            "value": "café"
          }
        ]
      },
      "properties": {
        "tags": [
          "café"
        ]
      },
      "passes": true
    },
    {
      "name": "contains on an empty list fails",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "tags",
            "operator": "contains",
            "value": "vip"
          }
        ]
      },
      "properties": {
        "tags": []
      },
      "passes": false
    },
    {
      "name": "exists with a value",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "exists"
          }
        ]
      },
      "properties": {
        "plan": "pro"
      },
      "passes": true
    },
    {
      "name": "exists with an empty string is present",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "nick",
            "operator": "exists"
          }
        ]
      },
      "properties": {
        "nick": ""
      },
      "passes": true
    },
    {
      "name": "exists with an empty list is present",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "tags",
            "operator": "exists"
          }
        ]
      },
      "properties": {
        "tags": []
      },
      "passes": true
    },
    {
      "name": "exists missing fails",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "exists"
          }
        ]
      },
      "properties": {
        "age": 30
      },
      "passes": false
    },
    {
      "name": "notExists missing passes",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "notExists"
          }
        ]
      },
      "properties": {
        "age": 30
      },
      "passes": true
    },
    {
      "name": "notExists present fails",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "notExists"
          }
        ]
      },
      "properties": {
        "plan": "pro"
      },
      "passes": false
    },
    {
      "name": "null property value is dropped, so exists fails",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "exists"
          }
        ]
      },
      "properties": {
        "plan": null
      },
      "passes": false
    },
    {
      "name": "null property value is dropped, so notExists passes",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "notExists"
          }
        ]
      },
      "properties": {
        "plan": null
      },
      "passes": true
    },
    {
      "name": "all: both conditions hold",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "eq",
            "value": "pro"
          },
          {
            "property": "age",
            "operator": "gte",
            "value": 18
          }
        ]
      },
      "properties": {
        "plan": "pro",
        "age": 18
      },
      "passes": true
    },
    {
      "name": "all: one condition fails",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "eq",
            "value": "pro"
          },
          {
            "property": "age",
            "operator": "gte",
            "value": 18
          }
        ]
      },
      "properties": {
        "plan": "pro",
        "age": 17
      },
      "passes": false
    },
    {
      "name": "all: three conditions hold",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "eq",
            "value": "pro"
          },
          {
            "property": "age",
            "operator": "gte",
            "value": 18
          },
          {
            "property": "country",
            "operator": "in",
            "value": [
              "fr",
              "nl"
            ]
          }
        ]
      },
      "properties": {
        "plan": "pro",
        "age": 40,
        "country": "NL"
      },
      "passes": true
    },
    {
      "name": "any: one condition holds",
      "rule": {
        "match": "any",
        "conditions": [
          {
            "property": "plan",
            "operator": "eq",
            "value": "pro"
          },
          {
            "property": "age",
            "operator": "gte",
            "value": 18
          }
        ]
      },
      "properties": {
        "plan": "free",
        "age": 18
      },
      "passes": true
    },
    {
      "name": "any: none holds",
      "rule": {
        "match": "any",
        "conditions": [
          {
            "property": "plan",
            "operator": "eq",
            "value": "pro"
          },
          {
            "property": "age",
            "operator": "gte",
            "value": 18
          }
        ]
      },
      "properties": {
        "plan": "free",
        "age": 17
      },
      "passes": false
    },
    {
      "name": "any: missing property alone fails, present one passes",
      "rule": {
        "match": "any",
        "conditions": [
          {
            "property": "vip",
            "operator": "eq",
            "value": true
          },
          {
            "property": "plan",
            "operator": "eq",
            "value": "pro"
          }
        ]
      },
      "properties": {
        "plan": "pro"
      },
      "passes": true
    },
    {
      "name": "all: missing eq fails the rule even with neq true",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "vip",
            "operator": "eq",
            "value": true
          },
          {
            "property": "plan",
            "operator": "neq",
            "value": "free"
          }
        ]
      },
      "properties": {
        "plan": "pro"
      },
      "passes": false
    },
    {
      "name": "all: missing neq and notExists both pass",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "vip",
            "operator": "neq",
            "value": true
          },
          {
            "property": "beta",
            "operator": "notExists"
          }
        ]
      },
      "properties": {
        "plan": "pro"
      },
      "passes": true
    },
    {
      "name": "any: empty properties pass only a negated condition",
      "rule": {
        "match": "any",
        "conditions": [
          {
            "property": "plan",
            "operator": "eq",
            "value": "pro"
          },
          {
            "property": "beta",
            "operator": "notExists"
          }
        ]
      },
      "properties": {},
      "passes": true
    },
    {
      "name": "property names are case-sensitive",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "Plan",
            "operator": "eq",
            "value": "pro"
          }
        ]
      },
      "properties": {
        "plan": "pro"
      },
      "passes": false
    },
    {
      "name": "property names may hold dots and dashes",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "user.age-group",
            "operator": "eq",
            "value": "adult"
          }
        ]
      },
      "properties": {
        "user.age-group": "adult"
      },
      "passes": true
    },
    {
      "name": "property name starting with a digit is dropped",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "1abc",
            "operator": "exists"
          }
        ]
      },
      "properties": {
        "1abc": "x"
      },
      "passes": false
    },
    {
      "name": "list with a non-string item is dropped",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "tags",
            "operator": "contains",
            "value": "a"
          }
        ]
      },
      "properties": {
        "tags": [
          "a",
          2
        ]
      },
      "passes": false
    },
    {
      "name": "list of 51 items is dropped",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "tags",
            "operator": "exists"
          }
        ]
      },
      "properties": {
        "tags": [
          "t0",
          "t1",
          "t2",
          "t3",
          "t4",
          "t5",
          "t6",
          "t7",
          "t8",
          "t9",
          "t10",
          "t11",
          "t12",
          "t13",
          "t14",
          "t15",
          "t16",
          "t17",
          "t18",
          "t19",
          "t20",
          "t21",
          "t22",
          "t23",
          "t24",
          "t25",
          "t26",
          "t27",
          "t28",
          "t29",
          "t30",
          "t31",
          "t32",
          "t33",
          "t34",
          "t35",
          "t36",
          "t37",
          "t38",
          "t39",
          "t40",
          "t41",
          "t42",
          "t43",
          "t44",
          "t45",
          "t46",
          "t47",
          "t48",
          "t49",
          "t50"
        ]
      },
      "passes": false
    },
    {
      "name": "list of 50 items is kept",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "tags",
            "operator": "contains",
            "value": "t49"
          }
        ]
      },
      "properties": {
        "tags": [
          "t0",
          "t1",
          "t2",
          "t3",
          "t4",
          "t5",
          "t6",
          "t7",
          "t8",
          "t9",
          "t10",
          "t11",
          "t12",
          "t13",
          "t14",
          "t15",
          "t16",
          "t17",
          "t18",
          "t19",
          "t20",
          "t21",
          "t22",
          "t23",
          "t24",
          "t25",
          "t26",
          "t27",
          "t28",
          "t29",
          "t30",
          "t31",
          "t32",
          "t33",
          "t34",
          "t35",
          "t36",
          "t37",
          "t38",
          "t39",
          "t40",
          "t41",
          "t42",
          "t43",
          "t44",
          "t45",
          "t46",
          "t47",
          "t48",
          "t49"
        ]
      },
      "passes": true
    },
    {
      "name": "an object value is dropped, so exists fails",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "x",
            "operator": "exists"
          }
        ]
      },
      "properties": {
        "x": {
          "a": 1
        }
      },
      "passes": false
    },
    {
      "name": "a boolean or string list value is kept whole",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "beta",
            "operator": "eq",
            "value": true
          },
          {
            "property": "tags",
            "operator": "contains",
            "value": "b"
          }
        ]
      },
      "properties": {
        "beta": true,
        "tags": [
          "a",
          "b"
        ]
      },
      "passes": true
    },
    {
      "name": "the viewer's list is compared item by item, not as text",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "tags",
            "operator": "contains",
            "value": "a,b"
          }
        ]
      },
      "properties": {
        "tags": [
          "a",
          "b"
        ]
      },
      "passes": false
    },
    {
      "name": "the match mode is all unless any",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "eq",
            "value": "pro"
          }
        ]
      },
      "properties": {
        "plan": "pro"
      },
      "passes": true
    },
    {
      "name": "a single any condition",
      "rule": {
        "match": "any",
        "conditions": [
          {
            "property": "plan",
            "operator": "eq",
            "value": "pro"
          }
        ]
      },
      "properties": {
        "plan": "free"
      },
      "passes": false
    },
    {
      "name": "eq value string with trailing space matches trimmed viewer",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "eq",
            "value": "pro "
          }
        ]
      },
      "properties": {
        "plan": "pro"
      },
      "passes": true
    },
    {
      "name": "ties: a viewer with only blank properties still has properties set",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "plan",
            "operator": "notExists"
          }
        ]
      },
      "properties": {
        "": ""
      },
      "passes": true
    },
    {
      "name": "prototype name is not a property",
      "rule": {
        "match": "all",
        "conditions": [
          {
            "property": "constructor",
            "operator": "exists"
          }
        ]
      },
      "properties": {},
      "passes": false
    }
  ]
}
"""
