#nullable enable

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Numerics;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace JsonHarness;

/// <summary>
/// Reads each case's JSON into its generated types, writes it back, and checks that nothing was
/// lost: every value comes back where it was, the same text, or the same number, GUID, or date,
/// time and offset where the text may differ. Cases whose names only match with attributes they
/// lack ("read") only have to read.
/// </summary>
public static class Harness
{
    private static readonly List<string> Failures = [];
    private static int count;

    public static void Verify<T>(string name, string serializer, string json)
    {
        count++;
        try
        {
            string written;
            if (serializer == "newtonsoft")
            {
                var value = Newtonsoft.Json.JsonConvert.DeserializeObject<T>(json);
                written = Newtonsoft.Json.JsonConvert.SerializeObject(value);
            }
            else
            {
                // "read": System.Text.Json, only reading, for names written without attributes.
                var value = JsonSerializer.Deserialize<T>(json);
                written = JsonSerializer.Serialize(value);
            }
            if (serializer == "read") return;
            var difference = Compare(JsonNode.Parse(json), JsonNode.Parse(written), "$");
            if (difference != null) Failures.Add($"{name}: {difference}\n  wrote {written}");
        }
        catch (Exception e)
        {
            Failures.Add($"{name}: {e.GetType().Name}: {e.Message}");
        }
    }

    public static int Report()
    {
        foreach (var failure in Failures) Console.WriteLine(failure);
        Console.WriteLine($"{count - Failures.Count} of {count} cases read back intact");
        return Failures.Count == 0 ? 0 : 1;
    }

    private static string? Compare(JsonNode? expected, JsonNode? actual, string path)
    {
        if (expected == null) return actual == null ? null : $"{path}: expected null, got {actual.ToJsonString()}";
        if (actual == null) return $"{path}: expected {expected.ToJsonString()}, got null";
        switch (expected)
        {
            case JsonObject e when actual is JsonObject a:
                foreach (var (key, value) in e)
                {
                    a.TryGetPropertyValue(key, out var other);
                    var difference = Compare(value, other, $"{path}.{key}");
                    if (difference != null) return difference;
                }
                // Members missing from the JSON come back as null; anything else is extra.
                var extra = a.Where(p => !e.ContainsKey(p.Key) && p.Value != null).Select(p => p.Key).ToList();
                return extra.Count == 0 ? null : $"{path}: unexpected {string.Join(", ", extra)}";
            case JsonArray e when actual is JsonArray a:
                if (e.Count != a.Count) return $"{path}: expected {e.Count} items, got {a.Count}";
                for (var i = 0; i < e.Count; i++)
                {
                    var difference = Compare(e[i], a[i], $"{path}[{i}]");
                    if (difference != null) return difference;
                }
                return null;
            case JsonValue e when actual is JsonValue a:
                return SameValue(e, a) ? null : $"{path}: expected {e.ToJsonString()}, got {a.ToJsonString()}";
            default:
                return $"{path}: expected {expected.ToJsonString()}, got {actual.ToJsonString()}";
        }
    }

    private static bool SameValue(JsonValue expected, JsonValue actual)
    {
        var e = expected.GetValue<JsonElement>();
        var a = actual.GetValue<JsonElement>();
        if (e.ValueKind != a.ValueKind) return false;
        switch (e.ValueKind)
        {
            case JsonValueKind.Number:
                return Canonical(e.GetRawText()) == Canonical(a.GetRawText());
            case JsonValueKind.String:
                var (es, @as) = (e.GetString()!, a.GetString()!);
                if (es == @as) return true;
                if (GuidText.IsMatch(es)) return Guid.TryParse(@as, out var g) && g == Guid.Parse(es);
                return SameDate(es, @as);
            default:
                return e.GetRawText() == a.GetRawText();
        }
    }

    private static readonly Regex GuidText = new(@"^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$");
    private static readonly Regex NumberText = new(@"^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$");
    private static readonly Regex Offset = new(@"(Z|[+-]\d\d:\d\d)$");

    /// <summary>A number's exact value as text, however it was written: 1.50, 15e-1 → 15e-1.</summary>
    private static string Canonical(string raw)
    {
        var match = NumberText.Match(raw);
        if (!match.Success) return raw;
        var digits = (match.Groups[2].Value + match.Groups[3].Value).TrimStart('0');
        var exponent = BigInteger.Parse(match.Groups[4].Success ? match.Groups[4].Value : "0", CultureInfo.InvariantCulture)
            - match.Groups[3].Value.Length;
        if (digits.Length == 0) return "0";
        var trimmed = digits.TrimEnd('0');
        exponent += digits.Length - trimmed.Length;
        return $"{match.Groups[1].Value}{trimmed}e{exponent}";
    }

    /// <summary>
    /// The same date and time of day, and the same offset if the original had one. Written back,
    /// a value without an offset gains the local one, and a date gains midnight.
    /// </summary>
    private static bool SameDate(string expected, string actual)
    {
        const DateTimeStyles style = DateTimeStyles.None;
        if (!DateTimeOffset.TryParse(expected, CultureInfo.InvariantCulture, style, out var e)
            || !DateTimeOffset.TryParse(actual, CultureInfo.InvariantCulture, style, out var a))
            return false;
        return e.DateTime == a.DateTime && (!Offset.IsMatch(expected) || e.Offset == a.Offset);
    }
}
