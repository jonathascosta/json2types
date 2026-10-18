#nullable enable

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Numerics;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace JsonHarness;

/// <summary>
/// Reads each case's JSON into its generated types, writes it back, and checks that nothing was
/// lost: every value comes back where it was, equal as a number, date or GUID where the text may
/// differ. Without attributes the names don't match, so those cases only have to read.
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
                var value = JsonSerializer.Deserialize<T>(json);
                written = JsonSerializer.Serialize(value);
            }
            if (serializer == "none") return;
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
                var (et, at) = (e.GetRawText(), a.GetRawText());
                if (et == at) return true;
                const NumberStyles style = NumberStyles.Float;
                if (decimal.TryParse(et, style, CultureInfo.InvariantCulture, out var ed)
                    && decimal.TryParse(at, style, CultureInfo.InvariantCulture, out var ad))
                    return ed == ad;
                if (BigInteger.TryParse(et, CultureInfo.InvariantCulture, out var eb)
                    && BigInteger.TryParse(at, CultureInfo.InvariantCulture, out var ab))
                    return eb == ab;
                return double.Parse(et, CultureInfo.InvariantCulture) == double.Parse(at, CultureInfo.InvariantCulture);
            case JsonValueKind.String:
                var (es, @as) = (e.GetString()!, a.GetString()!);
                if (es == @as) return true;
                if (Guid.TryParse(es, out var eg) && Guid.TryParse(@as, out var ag)) return eg == ag;
                const DateTimeStyles dates = DateTimeStyles.AssumeLocal;
                return DateTimeOffset.TryParse(es, CultureInfo.InvariantCulture, dates, out var edt)
                    && DateTimeOffset.TryParse(@as, CultureInfo.InvariantCulture, dates, out var adt)
                    && edt == adt;
            default:
                return e.GetRawText() == a.GetRawText();
        }
    }
}
