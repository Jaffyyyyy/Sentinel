"use strict";

window.BRAND_GUIDE_ENRICHMENT = {
  nike: {
    washTags: ["Older garments may use sewn fabric labels with separate care/content information; layouts vary by garment and production market.", "Later products commonly use style/color codes and multilingual care labels. Codes are product references, not a universal date decoder.", "Compare the exact garment, country, fabric and documented period. Do not date a piece from a single tag color, font, or logo."],
    collaborations: ["Comme des Garçons", "Off-White", "sacai", "Travis Scott", "Supreme", "fragment design"],
    rarity: "Scarcity can be specific to a style code, sample, region, release, or documented collaboration. General-release colorways and high-profile limited pairs should not be assigned the same rarity."
  },
  adidas: {
    washTags: ["Older sportswear labels vary by decade, factory, and region; compare sewn neck, side-seam, and care labels together.", "Later apparel commonly carries article/style codes and multilingual fiber/care text. Article numbers locate product records better than a logo.", "There is no single Three-Stripes tag timeline that dates every shoe or garment; use model-specific catalog references."],
    collaborations: ["Wales Bonner", "Bad Bunny", "Pharrell Williams", "Gucci", "Stella McCartney", "Yohji Yamamoto / Y-3"],
    rarity: "Check whether an item was a numbered special release, regional launch, sample, or ordinary inline style. A collaboration name alone does not prove a low production count."
  },
  puma: {
    washTags: ["Older sewn labels and logo treatments differ across apparel lines, factories, and licensing markets.", "Modern care labels and style numbers can help locate a model and season; compare exact article code and garment construction.", "Logo variations are clues, not a universal way to date PUMA products."],
    collaborations: ["FENTY by Rihanna", "Alexander McQueen", "Scuderia Ferrari", "PUMA x AMI"],
    rarity: "Research the exact style and release: a numbered capsule, regional product, team issue, or sample may be less available than a core model."
  },
  reebok: {
    washTags: ["Vintage apparel label layouts vary across licensed products and production regions; inspect neck and care labels as a pair.", "Later garment tags may include style codes, fiber content, and licensee/manufacturer details.", "The Vector or Union Jack design can provide context but cannot date every Reebok item on its own."],
    collaborations: ["Maison Margiela", "Pyer Moss", "Victoria Beckham"],
    rarity: "Treat special projects, samples, and region-specific releases as item-level research leads; verify the exact model and release documentation."
  },
  champion: {
    washTags: ["Vintage Champion neck labels and care tags vary by decade, garment type, and production market; no single label detail covers every sweatshirt.", "Reverse Weave labels, fiber/care tags, and country details should be compared as a complete set against dated examples.", "The sleeve C mark has changed and appears on many eras; do not date a garment from the C alone."],
    collaborations: ["Supreme", "BEAMS", "Todd Snyder"],
    rarity: "Older Reverse Weave, licensed team garments, and specific regional graphics can be sought after, but age alone does not make a sweatshirt rare. Check dated references, condition, and provenance."
  },
  "new-balance": {
    washTags: ["Apparel tags and footwear tongue labels use different conventions; do not apply a garment wash-tag timeline to shoes.", "For shoes, compare the tongue label's style/width/size fields, production origin, and sole details.", "Style and country codes can narrow a version but are not, by themselves, an authentication test."],
    collaborations: ["Aimé Leon Dore", "Joe Freshgoods", "JJJJound", "Salehe Bembury", "Miu Miu"],
    rarity: "Some collaborations release in restricted quantities, but release counts are not always public. Compare the exact SKU, market, and release evidence."
  },
  "under-armour": {
    washTags: ["Older compression apparel often emphasizes fabric technology and fiber content; label formats vary with product line.", "Later items may show style codes, HeatGear/ColdGear family, multilingual care, and licensed team details.", "A technology name or printed emblem cannot independently establish age or authenticity."],
    collaborations: ["Stephen Curry / Curry Brand", "The Rock / Project Rock", "Under Armour x Disney (licensed collections)"],
    rarity: "Team-issued, athlete-signed, prototype, and public retail versions are different categories. Establish which one an item is before judging rarity."
  },
  "the-north-face": {
    washTags: ["Older outdoor garments can have multiple sewn labels for model, fiber/care, and manufacturing; surviving layouts vary.", "Later pieces commonly use style/color identifiers and technical fabric names; compare those to the matching model generation.", "Do not use one neck-label style or chest logo to assign a year to all jackets."],
    collaborations: ["Supreme", "Gucci", "sacai", "HYKE", "Kaws"],
    rarity: "Special capsules and region-specific models may be less common; confirm season, style code, and distribution. A collaboration label alone is not a rarity grade."
  },
  uniqlo: {
    washTags: ["Older care labels can show market-specific sizing, language, and fiber details; compare the whole label rather than isolated typography.", "Modern items use product/article numbers that can sometimes be matched to a product page or collaboration collection.", "A UT graphic or designer name should be checked against an actual collection record."],
    collaborations: ["JW Anderson", "Marimekko", "Kaws", "Engineered Garments", "Mame Kurogouchi"],
    rarity: "Most core basics are replenished products. Limited artist/seasonal collaborations can have different availability; verify the collection and market."
  },
  fila: {
    washTags: ["Vintage labels vary by Italian heritage products, later international production, and licensed markets.", "Check language, licensee/manufacturer, country, and garment construction together.", "FILA logo treatments changed over time but may also coexist across markets."],
    collaborations: ["Fendi (FENDI Mania)", "Fila x White Mountaineering"],
    rarity: "Collaborative capsules and specific regional releases may be harder to find than core sportswear; confirm the actual item and release."
  },
  dior: {
    washTags: ["Couture, ready-to-wear, shoes, and leather goods have distinct label systems; there is no single Dior wash-tag chronology.", "Compare the label, line, season, country, materials, and construction with the specific product category.", "Use dated reference pieces and expert review; typography alone cannot authenticate a Dior item."],
    collaborations: ["Air Jordan 1 / Jordan Brand", "Shawn Stüssy (Dior Men)", "Stone Island (Dior Men)"],
    rarity: "Runway samples, special editions, and retail pieces must be distinguished. Rarity claims need season-specific records, provenance, and evidence of distribution."
  },
  hermes: {
    washTags: ["Scarves, apparel, leather goods, and watches use different identification marks; do not treat them as one label timeline.", "For silk, record care/composition and design details; for leather, document stamps, hardware, construction, and provenance separately.", "Stamp formats and practices can change. A stamp alone cannot date or authenticate an item."],
    collaborations: ["Apple Watch Hermès (product partnership)"],
    rarity: "Made-to-order, special-order, runway, and ordinary retail pieces differ. Availability varies by item and market; claims such as 'quota bag' need provenance and context."
  },
  "nike-acg": {
    washTags: ["ACG clothing labels should be read with the garment's Nike style code, fabric, and product generation.", "Tag layouts and technical material callouts vary across ACG eras and production regions.", "Compare against dated ACG catalogs or archived official product records; do not infer a decade from the logo alone."],
    collaborations: ["Supreme", "sacai (Nike/ACG-related footwear projects)", "NikeLab and designer-led ACG collections"],
    rarity: "Separate a normal ACG retail item from a numbered project, sample, or region-limited release; verify the precise code and launch evidence."
  },
  levis: {
    washTags: ["Older jeans may have a paper or leather-like back patch, red tab, and period-specific care/lot information; features vary by model and market.", "Modern care labels commonly carry style/lot identifiers, fiber content, and multilingual washing instructions.", "Button stamps, tab variants, patch, and care label must be compared together. No single tab color or number reliably dates all Levi's."],
    collaborations: ["Nike (Levi's x Jordan Brand)", "Supreme", "BEAMS", "Junya Watanabe"],
    rarity: "Specific historic lots, documented prototypes, and unusual factory/region variants can be collectible. Confirm the exact lot, production, condition, and provenance."
  },
  wrangler: {
    washTags: ["Vintage western garments may combine a brand/care label with separate size, lot, or factory information.", "Later garments commonly show style/cut codes and fiber/care content; compare the code with the garment's pattern and hardware.", "Do not use one label color, rope logo, or snap style as a universal date chart."],
    collaborations: ["Stetson (western apparel projects)", "Katherine Johnson / historical heritage collections (verify exact item and market)"],
    rarity: "A particular western cut, deadstock example, or regional label can be less common; scarcity needs a defined model and condition comparison."
  },
  dickies: {
    washTags: ["Older workwear can have sewn labels and factory/style information that varies across production periods.", "Style number, pocket/seam layout, fiber content, and country of manufacture help distinguish familiar fits.", "Do not assign a date from one color of woven label; use a matched, dated reference."],
    collaborations: ["Supreme", "FUTURA Laboratories", "WACKO MARIA"],
    rarity: "Workwear staples were often made in quantity. Special collaboration, discontinued fit, or documented regional issue is a more meaningful rarity question."
  },
  patagonia: {
    washTags: ["Older Patagonia garments can have sewn labels with model, fabric, country, and care details; layout changes across lines and eras.", "Later labels commonly show style and color codes, fiber content, and care; use these to search matching product records.", "Tag color, logo mountain range, or a single code should not be treated as a complete dating or authenticity rule."],
    collaborations: ["Patagonia x Danner (footwear project)", "Patagonia Provisions and conservation partnerships (not garment collaborations)"],
    rarity: "Documented prototypes, discontinued technical models, and unusual colorways may attract collectors. Check the style code, season, condition, and repair history."
  },
  carhartt: {
    washTags: ["Vintage workwear labels, blanket/lining, hardware, and patch can vary by product and factory; there is no one-label date shortcut.", "Later care labels include style identifiers and fiber/care text. Distinguish Carhartt workwear from Carhartt WIP.", "Compare multiple features and dated examples. Patch shape or color alone is not a reliable year marker."],
    collaborations: ["A.P.C.", "sacai", "Neighborhood", "Invincible"],
    rarity: "Worn-in workwear is not automatically rare. Look for discontinued models, unusual factory/color variants, collaboration releases, and traceable history."
  },
  "carhartt-wip": {
    washTags: ["WIP has its own product/season context; do not apply a mainline workwear label timeline to WIP without a matching reference.", "Read care labels, woven brand labels, garment code, season, and country together.", "A Carhartt patch can appear across different lines and does not settle line, year, or authenticity."],
    collaborations: ["sacai", "A.P.C.", "Neighborhood", "Vans"],
    rarity: "Season-specific collaboration and discontinued WIP styles can be less common. Identify the exact product and release rather than grading the brand as a whole."
  },
  arcteryx: {
    washTags: ["Technical shells may have interior product, fiber, care, and seam-tape information; different generations and product lines use different layouts.", "Later style/model identifiers can be searched against official product records; consumer and LEAF product histories differ.", "A bird logo, zipper, or label alone cannot establish date or authenticity."],
    collaborations: ["BEAMS", "Palace", "Jil Sander+ (System_A)", "Satisfy"],
    rarity: "Limited capsules, early technical variants, and documented samples may be less common. Confirm line, style code, distribution, and actual condition."
  },
  columbia: {
    washTags: ["Older garments may have sewn brand, care, and fiber labels with market-specific details.", "Later product/style numbers and technology names can help locate the exact jacket generation.", "Technology labels are product-family clues, not standalone production dates."],
    collaborations: ["Kith", "Opening Ceremony"],
    rarity: "Some capsule collections and discontinued technical lines have lower availability; compare exact style, region, and documented release."
  },
  converse: {
    washTags: ["Older canvas footwear branding and labels vary by model, factory, and country; shoes do not have apparel wash tags.", "Later pairs typically include a tongue size/style label and product code; compare patch, sole, stitching, and production context.", "Chuck patch styles alone are not a complete dating or authenticity guide."],
    collaborations: ["Comme des Garçons PLAY", "JW Anderson", "Off-White", "Tyler, The Creator / Golf le Fleur"],
    rarity: "Numbered collabs, regional exclusives, and early vintage pairs can differ in scarcity. Confirm model, SKU, launch market, and condition."
  },
  vans: {
    washTags: ["For footwear, use tongue/size labels, style codes, heel patch, and outsole; apparel wash-tag timelines do not apply to shoes.", "Production country and construction vary over time and by product line.", "Checkerboard patterns and 'Off The Wall' marks are not reliable year or authenticity tests alone."],
    collaborations: ["Supreme", "WTAPS", "Palace", "Anderson .Paak / Vans"],
    rarity: "Collaboration colorways and regional drops can be harder to source; check the exact model code and release, not just the partner name."
  },
  asics: {
    washTags: ["ASICS shoes use model/tongue product labels rather than garment wash tags; apparel has separate care-label conventions.", "Compare the full style/article code, region/size fields, sole tooling, and colorway.", "ASICS and Onitsuka Tiger are related but distinct product lines; read the actual model label."],
    collaborations: ["Kiko Kostadinov", "JJJJound", "Cecilie Bahnsen", "A.P.C.", "Andersson Bell"],
    rarity: "Special collaboration releases may have restricted distribution, but release totals are not always published. Confirm SKU, colorway, market, and release evidence."
  },
  salomon: {
    washTags: ["Technical apparel labels vary by garment; footwear identification depends on tongue product code, outsole, chassis, and construction.", "Model generations can look similar while using different components; exact product code is essential.", "Do not infer production date from a logo treatment or quicklace alone."],
    collaborations: ["MM6 Maison Margiela", "Palace", "The Broken Arm", "Sandy Liang"],
    rarity: "Some designer and regional releases are less common than inline trail models; exact SKU, regional availability, and condition determine the comparison."
  },
  stussy: {
    washTags: ["Vintage Stüssy neck labels, care labels, blanks, and country details vary with era and production partner.", "Compare front/back neck labels, fabric/care text, print, seam construction, and dated catalog or lookbook evidence.", "Signature graphics alone do not date a shirt; many designs have been reprinted or reworked."],
    collaborations: ["Nike", "Levi's", "Our Legacy", "Comme des Garçons"],
    rarity: "Older graphics, limited regional runs, and documented collaboration releases may be sought after. Distinguish age, condition, and genuine scarcity."
  },
  supreme: {
    washTags: ["Supreme apparel labels and blanks vary over the brand's history and by garment type; compare neck and wash labels to the specific season.", "Collaboration garments may have partner-specific tags, trims, and construction.", "Popular box-logo print details are copied and should never be used as the only authenticity signal."],
    collaborations: ["The North Face", "Nike", "Stone Island", "Comme des Garçons", "Vans"],
    rarity: "A release being sold out does not establish long-term rarity. Check season, edition, collaboration, production/distribution evidence, and surviving examples."
  },
  bape: {
    washTags: ["BAPE labels, size tags, wash labels, and country details vary across product categories, eras, and licensed lines.", "Compare the complete label stack and stitching/print with references for that exact garment and period.", "Camouflage layout and a busy graphic are not authentication tests; counterfeit examples often imitate them."],
    collaborations: ["adidas", "Coach", "LEGO (licensed capsule)", "COMME des GARÇONS"],
    rarity: "Regional releases, numbered editions, and collabs can be limited; identify exact season and code. Do not equate a popular graphic with low supply."
  },
  "comme-des-garcons": {
    washTags: ["First identify the line—PLAY, HOMME PLUS, SHIRT, and other labels have distinct histories and label conventions.", "Read the full care label, season/line clues, fiber content, and country together.", "A heart-with-eyes graphic identifies a design family, not a specific year or authentic item."],
    collaborations: ["Converse", "Nike", "New Balance", "Supreme", "ASICS"],
    rarity: "Runway and special-line pieces differ from widely distributed PLAY basics. Rarity must be evaluated at the line, season, item, and market level."
  },
  gucci: {
    washTags: ["Apparel, bags, shoes, and accessories have separate label and production histories.", "Compare the line, season, material, interior label, hardware, and stitching with a like-for-like official/archive reference.", "Monogram canvas and a logo label are not sufficient to date or authenticate an item."],
    collaborations: ["adidas", "The North Face", "Disney", "Balenciaga (The Hacker Project)"],
    rarity: "Runway samples and special editions differ from regular retail products. Verify the precise release, season, distribution, and provenance."
  },
  prada: {
    washTags: ["Prada apparel labels and leather-goods interiors have different conventions; identify product category and line before comparing.", "Use the exact style, season, material, care/content label, and hardware for research.", "A triangular plaque, fabric type, or serial detail alone is not an authentication or dating shortcut."],
    collaborations: ["adidas", "NASA (Luna Rossa program partnership)"],
    rarity: "Special editions and documented runway pieces may be less available; verify release records and separate product rarity from resale demand."
  },
  burberry: {
    washTags: ["Burberry label wording and logo treatments have changed; apparel, scarves, and accessories use different label formats.", "Check care/content labels, line, season, country, construction, and pattern together.", "A Burberry check pattern is not unique to a single year and does not establish authenticity."],
    collaborations: ["Supreme", "Vivienne Westwood", "Palace"],
    rarity: "Limited capsules and runway products can be less common, but rarity depends on exact item, market, and surviving examples."
  },
  "louis-vuitton": {
    washTags: ["Leather goods use interior stamps and product-specific identifiers rather than garment wash-tag conventions.", "Date-code practices changed, and many newer items use other traceability systems; assess period and item category.", "A code, monogram canvas, or heat stamp by itself cannot establish date or authenticity."],
    collaborations: ["Supreme", "Takashi Murakami", "Yayoi Kusama", "fragment design"],
    rarity: "Runway, numbered, artist-collaboration, and ordinary retail pieces are distinct. Confirm the actual edition and provenance; do not rely on a model name alone."
  },
  chanel: {
    washTags: ["Clothing, bags, jewelry, and watches use different labels/markings; there is no universal CHANEL wash-tag timeline.", "Record the season, material, construction, and item-specific internal identifiers.", "Serial stickers/cards and logo details have changed and can be copied; no single marker confirms authenticity."],
    collaborations: ["Pharrell Williams (capsule/footwear projects)", "Jean-Paul Goude (campaign/creative work; not a garment label identifier)"],
    rarity: "Runway samples, limited special editions, and standard seasonal retail should be distinguished. Verify item, season, provenance, and documented release."
  },
  coach: {
    washTags: ["For bags, examine the creed patch and interior tag; for apparel, read the sewn fiber/care label separately.", "Serial/style number formats and factory information vary by item and period.", "A creed or serial number should be evaluated with stitching, leather, hardware, and provenance—not alone."],
    collaborations: ["BAPE", "Disney", "Jean-Michel Basquiat", "Champion"],
    rarity: "Special artist collections and numbered releases may be less common; assess the exact style, drop, condition, and verified production details."
  },
  rolex: {
    washTags: ["Watches do not have garment wash tags. Record model/reference, case, bracelet, dial, movement, and service documentation.", "Serial and reference conventions differ by period and may be altered or copied.", "Use a qualified watchmaker for inspection; photographs and a number lookup cannot establish authenticity."],
    collaborations: [],
    rarity: "Collectibility is reference-, dial-, configuration-, condition-, and provenance-specific. Claims of rarity need recognized documentation and expert assessment; the guide assigns no rarity grade."
  },
  seiko: {
    washTags: ["Watches do not use garment wash tags. Record the full case-back reference and movement caliber.", "Dial, case, serial, bracelet, region, and movement should be compared to a model-specific source.", "Parts-swapped watches exist; individual components may be genuine but not original to that configuration."],
    collaborations: ["PADI", "Rowing Blazers", "Brian May", "Street Fighter (licensed editions)"],
    rarity: "Limited editions and discontinued references may be more sought after, but production totals and regional availability vary. Verify the reference and configuration."
  },
  canon: {
    washTags: ["Cameras do not use garment wash tags. Record the camera model, region suffix, serial, lens mount, and lens separately.", "Official manuals and service records help distinguish model revisions.", "A matching logo or body shell is not enough to establish camera operation or provenance."],
    collaborations: [],
    rarity: "Collectibility can relate to a specific limited edition or working condition, not simply age. Check the exact model, serial context, and service history."
  },
  nikon: {
    washTags: ["Cameras do not use garment wash tags. Record model, body serial, mount, metering/version details, and lens markings.", "Model suffixes and regional variants matter; consult Nikon manuals and historical catalogs.", "Condition, repairs, and functionality can matter more than scarcity."],
    collaborations: [],
    rarity: "Production rarity is model- and variant-specific; verify the exact version and condition. The guide does not estimate collector value."
  },
  sony: {
    washTags: ["Electronics use model/serial plates and regulatory labels rather than clothing wash tags.", "Record the complete model including regional suffix and check official support documentation.", "Serial, software version, and accessories can distinguish a working set from a body-only listing."],
    collaborations: ["A Bathing Ape (selected Sony audio/electronics capsules)", "PlayStation licensed editions (edition-specific)"],
    rarity: "Limited console or artist editions need exact model and regional release evidence; an unusual color alone does not prove a rare production run."
  },
  fujifilm: {
    washTags: ["Cameras use body/lens model and serial markings, not garment wash tags.", "Distinguish Fujica, FinePix, X, GFX, Instax, and current product generations using the exact model identifier.", "Film simulation branding or a retro design does not establish production year."],
    collaborations: ["Nintendo / Instax (selected products)", "Wes Anderson / Instax campaign work (campaign is not itself a model identifier)"],
    rarity: "Special editions, limited colors, and discontinued models need product-specific launch records. Availability changes over time and by region."
  },
  lego: {
    washTags: ["Toys do not have garment wash tags. Record set number, piece/element numbers, mold markings, box version, and instructions.", "Different mold revisions may share the same set; use official set inventories and dated references.", "A single brick marking cannot identify a complete set or its year."],
    collaborations: ["Star Wars", "The LEGO Batman Movie / DC", "NASA and space-agency licensed sets", "Harry Potter"],
    rarity: "Retired sets, exclusive minifigures, and limited editions differ. Completeness, sealed/open status, box condition, and production evidence all affect comparison."
  },
  "hot-wheels": {
    washTags: ["Die-cast cars do not have garment wash tags. Record casting, base text, wheel type, paint/tampo, package, and release year.", "Base markings can reflect tooling or factory and should not be read as a simple production-year code.", "Compare the exact casting and variation to a dated collector catalog."],
    collaborations: ["Gucci Cadillac Seville (special edition)", "Daniel Arsham (selected projects)", "Supreme (selected releases)"],
    rarity: "Treasure Hunt labels, redlines, prototypes, and ordinary retail castings are not interchangeable rarity levels. Verify the variation and package."
  },
  casio: {
    washTags: ["Watches do not have garment wash tags. Use the full case-back model and module number.", "Manuals, display layout, button positions, and case markings help separate versions.", "A limited-edition colorway must be verified against a release source."],
    collaborations: ["NASA (selected G-SHOCK releases)", "Pac-Man", "Dragon Ball Z (licensed editions)", "BAPE (selected G-SHOCK releases)"],
    rarity: "Collaboration editions and regional exclusives need exact module/model and launch-market records. Condition and completeness change collector comparisons."
  }
};

window.BRAND_RARITY_FRAMEWORK = [
  { label: "Common", detail: "Regularly produced or broadly distributed in that item's market." },
  { label: "Less common", detail: "A specific season, region, variant, or discontinued run with comparative evidence." },
  { label: "Limited / documented rare", detail: "A verifiable limited release, numbered edition, or demonstrably small distribution." },
  { label: "Exceptional / one-off", detail: "A prototype, sample, unique commission, or archive piece supported by strong provenance." }
];
