// Where Anthropic offers Claude, from anthropic.com/supported-countries (read 2026-10-27),
// as ISO 3166-1 codes. Use from anywhere else puts the account's API access at risk, so
// the chat refuses it before a key is touched. Re-read the page when Anthropic changes it.
const SUPPORTED = new Set(
	(
		'AD AE AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BZ CA CD CF ' +
		'CG CH CI CL CM CO CR CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD ' +
		'GE GH GM GN GQ GR GT GW GY HN HR HT HU ID IE IL IN IQ IS IT JM JO JP KE KG KH KI KM KN ' +
		'KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MN MR MT MU MV MW MX ' +
		'MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PS PT PW PY QA RO RS RW SA SB SC ' +
		'SD SE SG SI SK SL SM SN SO SR SS ST SV SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG ' +
		'US UY UZ VA VC VN VU WS ZA ZM ZW'
	).split(' ')
);
// Ukraine is listed except Crimea, Sevastopol, Donetsk, Kherson, Luhansk and Zaporizhzhia.
const NOT_IN_UKRAINE = new Set(['43', '40', '14', '65', '09', '23']);

/** Whether Claude is offered here. A place Cloudflare can't tell (`XX`, Tor's `T1`) is not. */
export function supported(country?: string | null, region?: string | null): boolean {
	if (!country || !SUPPORTED.has(country)) return false;
	return !(country === 'UA' && region && NOT_IN_UKRAINE.has(region));
}
