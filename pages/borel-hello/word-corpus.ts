// Fixed word fixtures for source-font / Bézier-pen regression tests.
// Dictionary sample: macOS /usr/share/dict/words (web2), 50 lowercase words
// per initial letter, stratified across lengths 2-5, 6-8, 9-12 and 13-20.
// Everyday/connection words and phrases were selected independently of scores.
export const everydayWords = `
  about above across act action active actor add address after again against
  age ago agree air all almost alone along already also always amazing
  amount an animal another answer any anyone anything appear apple apply area
  arm around arrive art artist as ask at attention author away baby
  back bad bag balance ball bank base be beautiful because become bed
  before begin behind believe below best better between big bird black blue
  board body book born both box boy brain brand bread break bring
  brown brush build business but buy by call camera can canvas capital
  car care carry case cat catch cause center certain change character check
  child children choose circle city class clean clear close cloud coffee cold
  color come common company compare complete computer connect consider contain continue control
  cook cool corner cost could country course create cross crowd cry cup
  curve cut daily dark data date daughter day dead deal dear decide
  deep degree design detail develop did die different direct direction discover do
  doctor does dog done door down draw dream drink drive drop dry
  during each early earth easy eat edge effect egg eight either end
  energy enjoy enough enter equal error even evening event ever every everyone
  everything example eye face fact family far fast father feel few field
  fifteen fifty figure file fill final find fine finger finish fire first
  fit five flat floor flower fly follow food foot for force form
  found four frame free friend from front full fun future game garden
  general geometry get girl give glass go gold good got government great
  green ground group grow had hair half hand handwriting happen happy hard
  has have he head hear heart heat heavy held hello help her
  here high hill him his history hit hold home hope horse hot
  hour house how however human hundred idea if image important in include
  ink inside instead interest into is it item its itself job join
  just keep key kind know known land language large last late later
  law lead learn least leave left leg length less let letter level
  life light like line link list little live local long look loop
  lose lot love low made main make man many map mark market
  may me mean measure meet memory men message method middle might mind
  minute miss model money month more morning most mother motion mountain mouse
  move much music must my name nation near need never new news
  next nice night nine no node noise normal north not note nothing
  now number object observe of off often old on once one only
  open or orange order other our out outside over own page paint
  pair paper parent part pass past path pattern pay pen people percent
  perfect person picture place plan play point poor position possible power prepare
  present press pretty price print probably problem process program project property public
  pull push put quality question quick quite radio rain random range read
  ready real reason receive record red reference remember repeat report result return
  rich right ring rise river road rock roll room round rule run
  safe said same sample save saw say school science score screen sea
  second see seem self sentence separate serve set seven several shape share
  she short should show side sign similar simple since single sister sit
  six size sleep slow small smooth so soft some someone something sometimes
  son song soon sound source south space speak special spell spot spring
  square stage stamp stand start state stay step still stop store story
  straight strange stream street strong stroke student study style such summer sun
  support sure symbol system table take talk target teach team tell ten
  test than thank that the their them then there these they thick
  thin thing think third this those though thought three through time tip
  to today together too took top touch town trace tree true try
  turn two type under understand unit until up us use used usual
  value various very view visit voice wait walk want warm was watch
  water wave way we week well went were what when where which
  while white who whole why wide will win wind window with within
  without woman won wonder wood word work world would write written wrong
  year yellow yes yet you young your zero alligator banana basketball ballet
  balloon bitter bottle butter button buttercup butterfly cassette committee connection crossing excellent
  fallen feeling follower following goodwill grass lettering letters lettuce lightning lovely lollipop
  looping loops lullaby millennium million narrow newer nibble nickel noon notebook odd
  offer offline opposite parallel pepper pillow pressure promise puppy queen queue quiet
  rabbit rally really rhythm rhythms ribbon ripple roller rolling runner running scissors
  secretary silly slipper spelling spoon sunset sunny tattoo tattoos tapping tester testing
  thinner thinking thirty thirteen tomorrow travelling valley vanilla violet weather weekly welcome
  wheel whisper willow winner winning winter women wooden wool woolly worry writing
  yesterday zigzag zippy zipper zoo syzygy jazz pizza jazzier fizz buzz fuzzy
  cozy lazy zigzagging texture text typography geometric bezier drawing animator animation digital
  handwritten programming resolution smoothness strokes thickness intersection intersectional international communication accessibility responsibility
  perspective representative development extraordinary consciousness acknowledgement understanding demonstration transformation accomplishment interconnection multiplication
  punctuation pronunciation congratulations friendship wonderful architecture independent appropriate comparison perfection lowercase uppercase
  alphabet arithmetic measurement implementation connected context contextual initial medial isolated terminal apostrophe
  quotation semicolon colon comma period exclamation underscore ampersand asterisk hash bracket parenthesis
  hyphen slash backslash equality percentage currency dollar cent euro pound yen numeric
  january february march april june july august september october november december sunday
  monday tuesday wednesday thursday friday saturday jiwon borel
`.trim().split(/\s+/);

export const dictionaryWords = `
  abler adage afire ahull album aloof amman anna arar arrow aswim aurir
  axile abrotine acrasia advocacy ahaunch aliquant ambilogy anatheme antelude apology arghel asonia
  atrichia avocado acalycine activital aesthetics aleukemic amenorrheic anastasimos antanemic antiphonical appenditious aristulate
  astragalus autonomous accustomedness adenostemonous alchemistical amphiarthrodial angiomyosarcoma anthropogenetic antidictionary antirailwayist applicatively aristocraticalness
  asymptotically autonephrectomy bahoe bara bavin befan beode bifid bizz bluff bond bouge
  bree buck burry baffle barbet bawley bedtime bemirror bestench bilianic blancher bockerel
  borzoi breaden bubbling burnside bacteriology barleybreak beastishness benamidar bhutatathata biochemistry blackcock blowpoint
  botryomycoma breakshugh bronchophony burningly bacteriolysis barocyclonometer batrachoplasty benzoperoxide bibliomanianism bioprecipitation blastoneuropore blomstrandine
  brachiocyllosis bradyseismical bromonaphthalene bulbomembranous cadus caped cawky chank chink cinch cline cod
  cooee cothy crazy crunk cusec calathus capriped catalyst cervix chibrit ciliary cloggy
  coggledy condoner cornice crafty crudity cutaneal calycophoran carrageen cephalodymus childbearing cinchotoxine coagulation
  coloristic condensary contortion cosmocratic creosoter cutireaction capparidaceous cellulofibrous chemiluminescence chreotechnics circumspangle colinephritis
  compressingly consequentially controversially counterassociation counterthreat cuticularization dairy darr debus demon dewy dika
  ditch doily doria dozed drony duit dusio damper dearborn defence demount destroy
  diatom dimply disgood divulsor doodab drafter druith durain deactivate decretorial deltiology deperition
  desponder diamantoid dikaryotic disciplinary disminister disulphide doublegear dungannonite deanthropomorphic degradational dendrophilous dermatophytic
  determination diaphoretical diphosphothiamine discohexaster disengagement dispiteousness distractingly dramatization easer edder egma elder
  elute emote enoil epact erg esne etui excel eyer ecanda effigy eligible
  empark endermic enlaurel entomoid epigynum ergotist esthesis euphuize excuse extender ecphonesis electorate
  embryotomy endodontic ensignment epiblastema epitimesis erythrose eumoirous excipulum exotropism extracloacal educationally electroergometer
  electrosurgery emulsification endoperitonitis entertainment epistemological erythrocytolysin etioporphyrin exculpatorily expurgatorial extraphysiological faff farl
  feedy fetal filch flaff fling fluor folly foud fret fubsy fury fairling
  fatalist feminist fidget firearm flamfew flisky flywort forcedly forkwise framing frondose furbish
  faithbreaker faultsman ferrochrome fifteenthly fisticuffery flintworker flushingly forecastle foreweigh foveiform fringeflower fundmonger
  familiarizingly featherlessness ferroaluminum fibrinopurulent fideicommission flagellantism fluorobenzene forefeelingly forgetfulness fractionating frightfulness functionalist
  gait garad gay genom gif glam gluck golee gouge grein grum gule
  guyer galbulus gaoler gawkish geodetic gibbet glaiket glunch golder goutweed graylag groover
  gudewife guttate gallinuline gasoliery gemmology geophagia gingerleaf glochidia glyptotheca gooseflower granodiorite greenhorn
  grumpiness gymnophiona galatotrophic gangrenescent gastroenteric gastrophilite genealogically geomagnetician gingivolabial glossorrhaphy goniometrical grandfatherless
  gravitationally gynandromorphous haft hamel harry hawse heigh herl hie hive holey hoped
  hox humpy hyena haggle handbook harpless haytime heelless hempen herself hinnible holdup
  hookless hotness humulone hymnary halmawise haunching heliofugal hemogenetic hesychastic hieropathic holorhinal honorworthy
  humanitian hydronium hypernatural hyposcope harpsichordist hematoporphyrin hendecahedron heterodoxical hexylresorcinol homeocrystalline humerocubital hydromeningocele
  hyperalbuminosis hyperideation hypersusceptibility hypostomatous icaco iddat idyl ilex imbat impen incut ing
  inner inure irid iso ivy ideaed illipene impair impugn incubous inertia inguinal
  inornate insulse inustion ireless ismatic issite idiospasm immunization improvably inconstancy indurable infraction
  inrighted interaccuse interoceptor intrapontine iridorhexis isohalsine idolatrousness implacability incircumspect increasableness ineffectively inhabitability
  integropallial interdispensation interparental intestiniform invaluableness irretrievably jade jama jara jawed jelly jewel
  jina jixie joky joug juck jumba juror jackass jagless janitor jaspery jejunely
  jessur jiggish jitney joinery jotation jubilee jumble jurist jacketwise jailership jarringness jefferisite
  jestproof jobholder jointless journalist judgelike julolidin juramentally juttingly jackpuddinghood jeewhillijers jellification jocoseriosity
  joukerypawkery judgmatically jurisdictional jurisprudential jusquaboutist justifiability justificatory juxtapositive kaik kapp keach kelly
  keto kibe kinch kiver knezi kodro koph kreng kusam kaladana karite keeled
  kenspac ketose kibitzer kilovolt kintar klephtic knobbly koinon kosong kupper kaliborite karyolysis
  kataplexy keratinize kerygmatic kiddushin kinematics kingpiece kittlepins knifeproof kokerboom kritarchy kaolinization katachromasis
  kenogenetically keratocricoid keratoplastic kettledrummer kindheartedness kinetogenetic kittenhearted knickknackatory knowledgeless kryptocyanine lade lanaz
  lath leash lene liber limes lira lobar longe louch lulab luxe lacrosse
  lametta lapwork lavatic lecker lepidine liegely limuloid listener lockjaw looplet lucern lutanist
  laciniate lampblack larkingly lawmaking leguleian leucocism lifefully linguloid lithologist locutorship lovingness lutestring
  labyrinthodontian laminiplantation laryngofission laterostigmatic lentibulariaceous leuchtenbergite librarianship limnobiologically lithochromatic loculicidally lumberingness lymphocystosis
  mage manei marok maxim meng mewer mimeo mitty molka mora mousy mulch
  musty magneto manege marlock maxima mellow metate mimbar misnomer moiles moonface mottler
  mumpish myiosis magnetitic mantispid maxilliform memorabilia mesothelium metrotherapy millistere misotheism monkeylike moonwards
  multihead myofibroma macrosporophyl manganiferous mechanistically meningococcus metalliferous metroperitonitis micronutrient misadvertence mistakableness monopolitical
  multifistular myelocythaemia nacry nakoo nares nave neeld nesh ngapi nigua nival noisy
  nor nowel nunch nailing nasalism naysay negligee nestage nibong ninnyish noetics nongray
  nonutile notecase nucleary nurtural nasillation negativeness nervosity nicknameable nominalism noncivilized nonenduring nonirritant
  nonpresence nonsovereign normative nulliverse necromantically neuropathology nonacquisitive noncoagulable nonconsumption nondifferentiable nonextrication nonintersecting
  nonpermission nonrefutation nonsporeforming northeastward oasal ochro odoom oh olam omina ooid orad
  oriel osone outdo ovum oxeye obloquy odaller oleocyst oogeny opulence orpheum ouphish
  outgreen outsally outwrite overhair overskip oxcart obreptitious octospermous olivinefels operoseness organicist oscheolith
  outbranch overafflict overestimate overmeanly oversoftly oxidizable occasionalistic olericultural oophorhysterectomy opisthorchiasis ornithologically osphresiophilia
  ovatoacuminate overconscious overexertedly overlaudation overrationalize overthrowable pain parao paw pelt pheal piki
  pirr plock poler porto prine puddy purre pallone parial peasecod perform phrasify
  pincher platea poinder porous precox priory psalmist purrel pancreectomy partition pepperweed petromastoid
  phytometer pleomorphist polystome preanimism premeditator probatory protanopic puncturation paleontographic partimembered peristeromorphic phlegmatically
  physiophilosopher pneumonodynia postmillenarianism prediscontent presufficiently pronationalist pseudocartilaginous psychotechnician qua quail quant quash
  quaw quean queme quey quill quip quirl quo quota quadra quaily quarred
  quasky queachy quemado questor quietive quincunx quinonic quintole quittor quondam quadratics quadrilobate
  quadruply quantifiable quarterly queasiness quercivorous quicksand quinarius quinopyrin quintuple quizzingly quadratojugal quadricrescentoid
  quadrigeminous quadrioxalate quadrisulphide quadruplicity quartermastership querimoniousness quinocarbonium quinquelobated quinquesyllable quintuplication rafty rank
  ray recon reges repen revie riff ritzy rokee rotan ruck rusk raggily
  rasped rebawl recubant refuse relight repoll ressala reverer ridgelet robinet rosily ruminant
  radioscopic readvertency reclusory redemptrice registrate remainder repossession respectably retrofract rhinocerine rivulation rubification
  radiodiagnosis reactionarist recitativical recorporification reflectibility reincarnation remorselessness reproachingly restandardize retrodisplacement revolutionizement roentgenologically
  salep scan sedum sham shuff skaff slip snick sooth spile steel stud
  swat salvific schemata sebific sesame shotstar sixpence smashage sommaite spinner stancher stramash
  subsolar sweeping sanitarium scortation semilooper shapeless siphonopore solipedous spiritism statoscope strepitous subnitrate
  supercentral syllabicness saprolegniaceous seasonableness semiphilosophical shadelessness southernliness splenomalacia stertorousness subdistinction sulfarsphenamine superdividend
  superrefinement syllogistically tahin tapa tawer tekke thatn thung ting token torve tray
  truly tuner twice tailrace taplet tearful terebene thereoid thwaite tiphead tonight townland
  triadism trizoic tugboat twicet talofibular teetaller terebenthene tharfcake thiocarbonyl tickseeded topmostly trailmaking
  tremblingly trilinoleate trophotaxis turtledove tautologically temporomastoid tetrachloroethane thenceforward thermopolypnea thrustfulness toxicodermatitis transcontinental
  transpenetrable tribophosphoroscope triricinolein tubulodermoid uhlan ulua unau unde ungot unlap unray untop
  upfly ura urial usher uval unaffied unbuying underact unfierce unhand unkind unmuddle
  unraided unshrew unteach unwilled uprender urogram unalliedly uncelestial undefending underverse unexcelling unguentary
  univoltine unoperculate unravelment unsevered untalking upbrought umbriferousness unbelievingly unconduciveness undemocratically undiscriminatingness unextravagant
  unincorporated unmisconceivable unprecedented unrepresentation unstylishness unweariability vague valva varna vaunt veldt verek
  vexed vifda vined virl viuva voile vowel vagary valved varier veiledly venger
  verify vesperal vicelike viminal virgater vitals voidless voteless vaginitis vaporimeter vasotripsy vendicate
  verbalizer versation veterinary villaette viperling visuometer vociferative vorticosely vaginoabdominal vanitarianism vasostimulant ventriculitic
  ventroposterior vermiparousness vertebroiliac vesiculotubular villiplacental viscometrically vivisectionist volunteership waer wally warty weal
  welk whank whift whush wingy witty woof wrap wusp wagsome wanigan wartern
  waxily weekwam whapuka whinnel wickless windball wished wonegan workhand wriggler walletful wasteness
  waywardly weirdlike whenceeer whiskified whortleberry windowpeeper witchcraft womankind wordmongery wretchless wanderingness watchlessness
  weakheartedness weatherliness weinschenkite wheretosoever wholeheartedness windowlessness withdrawingness woodcraftsman workwomanlike wrongheadedly xebec xenon
  xenyl xeric xoana xurel xylan xylem xylic xylon xylyl xyrid xysti xanthein
  xanthite xenagogy xenogeny xeransis xeroma xerotes xiphuous xyletic xylitone xyloma xylotomy xystos
  xanthinuria xanthogenic xanthorrhoea xenobiosis xenoparasite xenopteran xeromorph xerophthalmy xiphisternal xiphosuran xylomancy xyloquinone
  xanthocarpous xanthochroous xanthocyanopsy xanthogenamide xanthomyeloma xanthoproteic xanthopurpurin xenomorphosis xerodermatous xiphihumeralis xylographical xylotypographic
  yacht yale yapp yarth ycie yees yerga yez yirr yogin yont youve
  yuh yachtman yammadji yardang yarran yawney yearling yeller yercum yodeler yokelism yorker
  youthy yuckle yagourundi yardstick yearnfulness yellowbird yellowlegs yellowtail yeomanette yesterweek yohimbinize youngness
  youthless yttriferous yachtsmanlike yachtsmanship yellowishness yesterevening yestermorning yieldableness yohimbinization youthlessness youthlikeness yttrocolumbite
  yttrofluorite yttrotantalite zac zante zati zebub zemi zesty zimb zip zobo zoism
  zonar zoons zygon zaibatsu zapupe zebrule zephyr zillah ziphian zoetrope zonoid zoogonic
  zoonitic zoothome zwieback zymoid zealotism zestfully zingaresca zodiophilous zoocytium zoographist zoonosology zoophytic
  zoothecium zygantrum zygopterous zymophoric zepharovichite zincification zirconifluoride zonoplacental zoographically zoopathological zoophytological zoopsychology
  zugtierlaster zygodactylous zygomaticosphenoid zygosporophore
`.trim().split(/\s+/);

export const phrases: string[] = [
  "hello world",
  "name won",
  "spell it out",
  "little letters",
  "hello from apple",
  "hello hello hello",
  "hello name won",
  "new window",
  "narrow winding road",
  "willow and water",
  "warm woolly winter",
  "white walls",
  "winner takes all",
  "we will write",
  "now or never",
  "an open notebook",
  "in the middle",
  "follow the yellow line",
  "little lollipop",
  "pretty little letters",
  "rolling hills",
  "all together now",
  "a million little loops",
  "small still letters",
  "letter after letter",
  "little better butter",
  "a tattoo artist",
  "button and bottle",
  "better late than never",
  "coffee and butter",
  "beautiful butterfly",
  "lettering and typography",
  "minimum width",
  "maximum connection",
  "quick brown fox",
  "the quick brown fox jumps over the lazy dog",
  "sphinx of black quartz judge my vow",
  "pack my box with five dozen liquor jugs",
  "jazz and pizza",
  "fuzzy cozy socks",
  "you are here",
  "thank you",
  "happy birthday",
  "happy new year",
  "good morning",
  "have a lovely day",
  "the best is yet to come",
  "love and laughter",
  "make something wonderful",
  "every day is a new beginning",
  "Borel Handwriting",
  "Hello World",
  "Name Won",
  "Little Letters",
  "Apple Borel Hello",
  "HELLO WORLD",
  "NAME WON",
  "LITTLE LETTERS",
  "0123456789",
  "Hello, world!",
  "Don't stop writing.",
  "I'm happy; you're welcome.",
  "Write \"hello\" (again).",
  "Hello & goodbye!",
  "hello-world / name_won",
  "Price: $12.50 + 10% tax.",
  "Email: hello@example.com",
  "2026-10-08 at 10:30",
  "[Hello] {Borel} (Name Won)",
  "A+B=C; 2*3=6; 9/3=3",
  "Wow?! Yes... really!",
  "#hello @borel +100%",
  "O'Reilly's little notebook",
  "Hello\nName Won",
  "name\n\nwon"
];

export interface WordCase { text: string; group: string; maxWidth: number }
export const wordCases: WordCase[] = [
  ...everydayWords.map(text => ({ text, group: 'everyday lowercase', maxWidth: 30000 })),
  ...dictionaryWords.map(text => ({ text, group: 'dictionary lowercase', maxWidth: 30000 })),
  ...everydayWords.map(text => ({ text: text[0].toUpperCase() + text.slice(1), group: 'title case', maxWidth: 30000 })),
  ...everydayWords.map(text => ({ text: text.toUpperCase(), group: 'uppercase', maxWidth: 30000 })),
  ...phrases.map(text => ({ text, group: 'phrases / punctuation', maxWidth: 6200 })),
];
