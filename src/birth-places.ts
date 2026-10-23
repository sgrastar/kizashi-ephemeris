/**
 * Well-known cities on five continents (the five Olympic regions), as birthplaces for the best-births search
 * (src/best-births.ts). Coordinates to a hundredth of a degree; the time zone is the city's IANA zone, so a
 * birth time there is read with the offsets the city kept in that year.
 */
import type { BirthPlace } from './best-births.js';

type Row = [id: string, en: string, ja: string, latitude: number, longitude: number, timezone: string];

const ASIA: Row[] = [
  ['tokyo', 'Tokyo', '東京', 35.68, 139.69, 'Asia/Tokyo'], ['osaka', 'Osaka', '大阪', 34.69, 135.50, 'Asia/Tokyo'],
  ['sapporo', 'Sapporo', '札幌', 43.06, 141.35, 'Asia/Tokyo'], ['fukuoka', 'Fukuoka', '福岡', 33.59, 130.40, 'Asia/Tokyo'],
  ['naha', 'Naha', '那覇', 26.21, 127.68, 'Asia/Tokyo'], ['seoul', 'Seoul', 'ソウル', 37.57, 126.98, 'Asia/Seoul'],
  ['busan', 'Busan', '釜山', 35.18, 129.08, 'Asia/Seoul'], ['beijing', 'Beijing', '北京', 39.90, 116.40, 'Asia/Shanghai'],
  ['shanghai', 'Shanghai', '上海', 31.23, 121.47, 'Asia/Shanghai'], ['hong-kong', 'Hong Kong', '香港', 22.32, 114.17, 'Asia/Hong_Kong'],
  ['taipei', 'Taipei', '台北', 25.03, 121.56, 'Asia/Taipei'], ['manila', 'Manila', 'マニラ', 14.60, 120.98, 'Asia/Manila'],
  ['bangkok', 'Bangkok', 'バンコク', 13.75, 100.50, 'Asia/Bangkok'], ['hanoi', 'Hanoi', 'ハノイ', 21.03, 105.85, 'Asia/Bangkok'],
  ['ho-chi-minh', 'Ho Chi Minh City', 'ホーチミン', 10.82, 106.63, 'Asia/Ho_Chi_Minh'],
  ['kuala-lumpur', 'Kuala Lumpur', 'クアラルンプール', 3.14, 101.69, 'Asia/Kuala_Lumpur'],
  ['singapore', 'Singapore', 'シンガポール', 1.35, 103.82, 'Asia/Singapore'], ['jakarta', 'Jakarta', 'ジャカルタ', -6.21, 106.85, 'Asia/Jakarta'],
  ['denpasar', 'Denpasar (Bali)', 'デンパサール（バリ島）', -8.65, 115.22, 'Asia/Makassar'],
  ['delhi', 'Delhi', 'デリー', 28.61, 77.21, 'Asia/Kolkata'], ['mumbai', 'Mumbai', 'ムンバイ', 19.08, 72.88, 'Asia/Kolkata'],
  ['kolkata', 'Kolkata', 'コルカタ', 22.57, 88.36, 'Asia/Kolkata'], ['bengaluru', 'Bengaluru', 'ベンガルール', 12.97, 77.59, 'Asia/Kolkata'],
  ['kathmandu', 'Kathmandu', 'カトマンズ', 27.72, 85.32, 'Asia/Kathmandu'], ['dhaka', 'Dhaka', 'ダッカ', 23.81, 90.41, 'Asia/Dhaka'],
  ['karachi', 'Karachi', 'カラチ', 24.86, 67.01, 'Asia/Karachi'], ['tehran', 'Tehran', 'テヘラン', 35.69, 51.39, 'Asia/Tehran'],
  ['dubai', 'Dubai', 'ドバイ', 25.20, 55.27, 'Asia/Dubai'], ['riyadh', 'Riyadh', 'リヤド', 24.71, 46.68, 'Asia/Riyadh'],
  ['ulaanbaatar', 'Ulaanbaatar', 'ウランバートル', 47.89, 106.91, 'Asia/Ulaanbaatar'], ['almaty', 'Almaty', 'アルマトイ', 43.24, 76.89, 'Asia/Almaty'],
  ['tashkent', 'Tashkent', 'タシケント', 41.30, 69.24, 'Asia/Tashkent'],
];
const EUROPE: Row[] = [
  ['london', 'London', 'ロンドン', 51.51, -0.13, 'Europe/London'], ['manchester', 'Manchester', 'マンチェスター', 53.48, -2.24, 'Europe/London'],
  ['edinburgh', 'Edinburgh', 'エディンバラ', 55.95, -3.19, 'Europe/London'], ['dublin', 'Dublin', 'ダブリン', 53.35, -6.26, 'Europe/Dublin'],
  ['paris', 'Paris', 'パリ', 48.86, 2.35, 'Europe/Paris'], ['lyon', 'Lyon', 'リヨン', 45.76, 4.84, 'Europe/Paris'],
  ['marseille', 'Marseille', 'マルセイユ', 43.30, 5.37, 'Europe/Paris'], ['berlin', 'Berlin', 'ベルリン', 52.52, 13.40, 'Europe/Berlin'],
  ['munich', 'Munich', 'ミュンヘン', 48.14, 11.58, 'Europe/Berlin'], ['hamburg', 'Hamburg', 'ハンブルク', 53.55, 9.99, 'Europe/Berlin'],
  ['amsterdam', 'Amsterdam', 'アムステルダム', 52.37, 4.90, 'Europe/Amsterdam'], ['brussels', 'Brussels', 'ブリュッセル', 50.85, 4.35, 'Europe/Brussels'],
  ['zurich', 'Zurich', 'チューリッヒ', 47.38, 8.54, 'Europe/Zurich'], ['vienna', 'Vienna', 'ウィーン', 48.21, 16.37, 'Europe/Vienna'],
  ['prague', 'Prague', 'プラハ', 50.08, 14.44, 'Europe/Prague'], ['warsaw', 'Warsaw', 'ワルシャワ', 52.23, 21.01, 'Europe/Warsaw'],
  ['budapest', 'Budapest', 'ブダペスト', 47.50, 19.04, 'Europe/Budapest'], ['rome', 'Rome', 'ローマ', 41.90, 12.50, 'Europe/Rome'],
  ['milan', 'Milan', 'ミラノ', 45.46, 9.19, 'Europe/Rome'], ['madrid', 'Madrid', 'マドリード', 40.42, -3.70, 'Europe/Madrid'],
  ['barcelona', 'Barcelona', 'バルセロナ', 41.39, 2.17, 'Europe/Madrid'], ['lisbon', 'Lisbon', 'リスボン', 38.72, -9.14, 'Europe/Lisbon'],
  ['athens', 'Athens', 'アテネ', 37.98, 23.73, 'Europe/Athens'], ['istanbul', 'Istanbul', 'イスタンブール', 41.01, 28.98, 'Europe/Istanbul'],
  ['stockholm', 'Stockholm', 'ストックホルム', 59.33, 18.07, 'Europe/Stockholm'], ['oslo', 'Oslo', 'オスロ', 59.91, 10.75, 'Europe/Oslo'],
  ['copenhagen', 'Copenhagen', 'コペンハーゲン', 55.68, 12.57, 'Europe/Copenhagen'], ['helsinki', 'Helsinki', 'ヘルシンキ', 60.17, 24.94, 'Europe/Helsinki'],
  ['reykjavik', 'Reykjavik', 'レイキャビク', 64.15, -21.94, 'Atlantic/Reykjavik'], ['moscow', 'Moscow', 'モスクワ', 55.76, 37.62, 'Europe/Moscow'],
  ['kyiv', 'Kyiv', 'キーウ', 50.45, 30.52, 'Europe/Kyiv'],
];
const AFRICA: Row[] = [
  ['cairo', 'Cairo', 'カイロ', 30.04, 31.24, 'Africa/Cairo'], ['alexandria', 'Alexandria', 'アレクサンドリア', 31.20, 29.92, 'Africa/Cairo'],
  ['casablanca', 'Casablanca', 'カサブランカ', 33.57, -7.59, 'Africa/Casablanca'], ['marrakesh', 'Marrakesh', 'マラケシュ', 31.63, -8.01, 'Africa/Casablanca'],
  ['tunis', 'Tunis', 'チュニス', 36.81, 10.18, 'Africa/Tunis'], ['algiers', 'Algiers', 'アルジェ', 36.75, 3.06, 'Africa/Algiers'],
  ['lagos', 'Lagos', 'ラゴス', 6.52, 3.38, 'Africa/Lagos'], ['abuja', 'Abuja', 'アブジャ', 9.08, 7.40, 'Africa/Lagos'],
  ['accra', 'Accra', 'アクラ', 5.60, -0.19, 'Africa/Accra'], ['dakar', 'Dakar', 'ダカール', 14.72, -17.47, 'Africa/Dakar'],
  ['abidjan', 'Abidjan', 'アビジャン', 5.36, -4.01, 'Africa/Abidjan'], ['nairobi', 'Nairobi', 'ナイロビ', -1.29, 36.82, 'Africa/Nairobi'],
  ['addis-ababa', 'Addis Ababa', 'アディスアベバ', 9.03, 38.74, 'Africa/Addis_Ababa'], ['kampala', 'Kampala', 'カンパラ', 0.35, 32.58, 'Africa/Kampala'],
  ['dar-es-salaam', 'Dar es Salaam', 'ダルエスサラーム', -6.79, 39.21, 'Africa/Dar_es_Salaam'], ['kigali', 'Kigali', 'キガリ', -1.95, 30.06, 'Africa/Kigali'],
  ['kinshasa', 'Kinshasa', 'キンシャサ', -4.44, 15.27, 'Africa/Kinshasa'], ['luanda', 'Luanda', 'ルアンダ', -8.84, 13.23, 'Africa/Luanda'],
  ['johannesburg', 'Johannesburg', 'ヨハネスブルグ', -26.20, 28.05, 'Africa/Johannesburg'], ['cape-town', 'Cape Town', 'ケープタウン', -33.92, 18.42, 'Africa/Johannesburg'],
  ['durban', 'Durban', 'ダーバン', -29.86, 31.02, 'Africa/Johannesburg'], ['harare', 'Harare', 'ハラレ', -17.83, 31.05, 'Africa/Harare'],
  ['windhoek', 'Windhoek', 'ウィントフック', -22.56, 17.08, 'Africa/Windhoek'], ['antananarivo', 'Antananarivo', 'アンタナナリボ', -18.88, 47.51, 'Indian/Antananarivo'],
  ['port-louis', 'Port Louis', 'ポートルイス', -20.16, 57.50, 'Indian/Mauritius'], ['khartoum', 'Khartoum', 'ハルツーム', 15.50, 32.56, 'Africa/Khartoum'],
];
const AMERICAS: Row[] = [
  ['new-york', 'New York', 'ニューヨーク', 40.71, -74.01, 'America/New_York'], ['boston', 'Boston', 'ボストン', 42.36, -71.06, 'America/New_York'],
  ['washington', 'Washington, D.C.', 'ワシントンD.C.', 38.91, -77.04, 'America/New_York'], ['miami', 'Miami', 'マイアミ', 25.76, -80.19, 'America/New_York'],
  ['chicago', 'Chicago', 'シカゴ', 41.88, -87.63, 'America/Chicago'], ['houston', 'Houston', 'ヒューストン', 29.76, -95.37, 'America/Chicago'],
  ['denver', 'Denver', 'デンバー', 39.74, -104.99, 'America/Denver'], ['los-angeles', 'Los Angeles', 'ロサンゼルス', 34.05, -118.24, 'America/Los_Angeles'],
  ['san-francisco', 'San Francisco', 'サンフランシスコ', 37.77, -122.42, 'America/Los_Angeles'], ['seattle', 'Seattle', 'シアトル', 47.61, -122.33, 'America/Los_Angeles'],
  ['anchorage', 'Anchorage', 'アンカレッジ', 61.22, -149.90, 'America/Anchorage'], ['honolulu', 'Honolulu', 'ホノルル', 21.31, -157.86, 'Pacific/Honolulu'],
  ['toronto', 'Toronto', 'トロント', 43.65, -79.38, 'America/Toronto'], ['montreal', 'Montreal', 'モントリオール', 45.50, -73.57, 'America/Toronto'],
  ['vancouver', 'Vancouver', 'バンクーバー', 49.28, -123.12, 'America/Vancouver'], ['mexico-city', 'Mexico City', 'メキシコシティ', 19.43, -99.13, 'America/Mexico_City'],
  ['havana', 'Havana', 'ハバナ', 23.11, -82.37, 'America/Havana'], ['panama-city', 'Panama City', 'パナマシティ', 8.98, -79.52, 'America/Panama'],
  ['bogota', 'Bogotá', 'ボゴタ', 4.71, -74.07, 'America/Bogota'], ['caracas', 'Caracas', 'カラカス', 10.48, -66.90, 'America/Caracas'],
  ['quito', 'Quito', 'キト', -0.18, -78.47, 'America/Guayaquil'], ['lima', 'Lima', 'リマ', -12.05, -77.04, 'America/Lima'],
  ['la-paz', 'La Paz', 'ラパス', -16.49, -68.12, 'America/La_Paz'], ['santiago', 'Santiago', 'サンティアゴ', -33.45, -70.67, 'America/Santiago'],
  ['buenos-aires', 'Buenos Aires', 'ブエノスアイレス', -34.60, -58.38, 'America/Argentina/Buenos_Aires'],
  ['montevideo', 'Montevideo', 'モンテビデオ', -34.90, -56.16, 'America/Montevideo'], ['sao-paulo', 'São Paulo', 'サンパウロ', -23.55, -46.63, 'America/Sao_Paulo'],
  ['rio-de-janeiro', 'Rio de Janeiro', 'リオデジャネイロ', -22.91, -43.17, 'America/Sao_Paulo'],
];
const OCEANIA: Row[] = [
  ['sydney', 'Sydney', 'シドニー', -33.87, 151.21, 'Australia/Sydney'], ['melbourne', 'Melbourne', 'メルボルン', -37.81, 144.96, 'Australia/Melbourne'],
  ['brisbane', 'Brisbane', 'ブリスベン', -27.47, 153.03, 'Australia/Brisbane'], ['perth', 'Perth', 'パース', -31.95, 115.86, 'Australia/Perth'],
  ['adelaide', 'Adelaide', 'アデレード', -34.93, 138.60, 'Australia/Adelaide'], ['darwin', 'Darwin', 'ダーウィン', -12.46, 130.84, 'Australia/Darwin'],
  ['hobart', 'Hobart', 'ホバート', -42.88, 147.33, 'Australia/Hobart'], ['cairns', 'Cairns', 'ケアンズ', -16.92, 145.77, 'Australia/Brisbane'],
  ['auckland', 'Auckland', 'オークランド', -36.85, 174.76, 'Pacific/Auckland'], ['wellington', 'Wellington', 'ウェリントン', -41.29, 174.78, 'Pacific/Auckland'],
  ['christchurch', 'Christchurch', 'クライストチャーチ', -43.53, 172.64, 'Pacific/Auckland'], ['suva', 'Suva', 'スバ', -18.14, 178.44, 'Pacific/Fiji'],
  ['port-moresby', 'Port Moresby', 'ポートモレスビー', -9.44, 147.18, 'Pacific/Port_Moresby'], ['noumea', 'Nouméa', 'ヌメア', -22.27, 166.44, 'Pacific/Noumea'],
  ['papeete', 'Papeete', 'パペーテ', -17.54, -149.57, 'Pacific/Tahiti'], ['apia', 'Apia', 'アピア', -13.83, -171.76, 'Pacific/Apia'],
  ['hagatna', 'Hagåtña (Guam)', 'ハガニア（グアム）', 13.48, 144.75, 'Pacific/Guam'], ['port-vila', 'Port Vila', 'ポートビラ', -17.73, 168.32, 'Pacific/Efate'],
];

const place = (region: string) => ([id, en, ja, latitude, longitude, timezone]: Row): BirthPlace & { en: string; ja: string } =>
  ({ id, region, en, ja, latitude, longitude, timezone });

export const BIRTH_PLACES = Object.freeze([
  ...ASIA.map(place('asia')), ...EUROPE.map(place('europe')), ...AFRICA.map(place('africa')),
  ...AMERICAS.map(place('americas')), ...OCEANIA.map(place('oceania')),
]);
