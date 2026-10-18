import { describe, expect, it } from 'vitest';
import { avoidReserved, singular, typeName } from './names';

describe('typeName', () => {
  it.each([
    ['address', 'Address'],
    ['first_name', 'FirstName'],
    ['first name', 'FirstName'],
    ['last-name', 'LastName'],
    ['userId', 'UserId'],
    ['XMLHttpRequest', 'XMLHttpRequest'],
    ['2fa', 'Item2fa'],
    ['', 'Item'],
    ['---', 'Item'],
    ['$ref', 'Ref'],
    ['endereço', 'Endereço'],
    ['café', 'Café'],
    ['x²', 'X'],
    ['½price', 'Price'],
    ['Ⅻ', 'Ⅻ'],
    ['HOME_ADDRESS', 'HomeAddress'],
    ['USER_ID', 'UserID'],
    ['b\u20ddc', 'BC'],
    ['x\u2e2fy', 'XY'],
    ['\u0301abc', 'Abc'],
    ['ßtraße', 'ßtraße'],
    ['version', 'VersionItem'],
    ['date_time_offset', 'DateTimeOffsetItem'],
    ['json_element', 'JsonElementItem'],
    ['pick', 'PickItem'],
    ['string', 'StringItem'],
    ['date', 'DateItem'],
  ])('%j → %s', (key, name) => {
    expect(typeName(key)).toBe(name);
  });

  it('only produces identifiers valid in C# and TypeScript', () => {
    for (const key of ['a b', 'x²', '½', 'á', '١٢٣', 'über-größe', '日本語', 'emoji😀name']) {
      expect(typeName(key)).toMatch(/^[\p{L}\p{Nl}][\p{L}\p{M}\p{Nd}\p{Nl}]*$/u);
    }
  });
});

describe('singular', () => {
  it.each([
    ['Items', 'Item'],
    ['Categories', 'Category'],
    ['Addresses', 'Address'],
    ['Boxes', 'Box'],
    ['Statuses', 'Status'],
    ['Buses', 'Bus'],
    ['Gases', 'Gas'],
    ['Quizzes', 'Quiz'],
    ['People', 'Person'],
    ['Children', 'Child'],
    ['Movies', 'Movie'],
    ['Keys', 'Key'],
    ['URLs', 'URL'],
    ['UserIDs', 'UserID'],
    ['OrderLines', 'OrderLine'],
    ['Data', 'DataItem'],
    ['Status', 'StatusItem'],
    ['Analysis', 'AnalysisItem'],
    ['Class', 'ClassItem'],
    ['List', 'ListItem'],
    ['Os', 'OsItem'],
    ['Houses', 'House'],
    ['Clauses', 'Clause'],
    ['Causes', 'Cause'],
    ['Caches', 'Cache'],
    ['Niches', 'Niche'],
    ['Matches', 'Match'],
    ['Branches', 'Branch'],
    ['Churches', 'Church'],
    ['Wishes', 'Wish'],
    ['Viruses', 'Virus'],
    ['Heroes', 'Hero'],
    ['Items2', 'Item2'],
    ['Level2', 'Level2Item'],
    ['Covid19', 'Covid19Item'],
    ['Speeches', 'Speech'],
    ['Touches', 'Touch'],
    ['Avalanches', 'Avalanche'],
    ['Calories', 'Calorie'],
    ['Lies', 'Lie'],
    ['Leaves', 'Leaf'],
    ['Aliases', 'Alias'],
    ['Alias', 'AliasItem'],
    ['Canvas', 'CanvasItem'],
    ['Lens', 'LensItem'],
    ['Diagnoses', 'Diagnosis'],
    ['Echoes', 'Echo'],
    ['Constructor', 'ConstructorItem'],
    ['Constructors', 'Constructor'],
    ['Rookies', 'Rookie'],
    ['Selfies', 'Selfie'],
    ['Axes', 'Axis'],
    ['Phenomena', 'Phenomenon'],
    ['GPS', 'GPSItem'],
    ['Gps', 'GpsItem'],
    ['Sms', 'SmsItem'],
    ['Dns', 'DnsItem'],
    ['Apis', 'Api'],
    ['UserGPS', 'UserGPSItem'],
    ['ListItem', 'ListItem'],
  ])('%s → %s', (plural, name) => {
    expect(singular(plural)).toBe(name);
  });
});

describe('avoidReserved', () => {
  it('appends Item to built-in names only', () => {
    expect(avoidReserved('Error')).toBe('ErrorItem');
    expect(avoidReserved('Response')).toBe('ResponseItem');
    expect(avoidReserved('Order')).toBe('Order');
  });
});
