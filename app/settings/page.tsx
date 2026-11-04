'use client'

const USER_DISPLAY: Record<string, string> = { 'STAR': 'Steph' }
function displayUser(id: string | null | undefined) {
  if (!id) return '—'
  return USER_DISPLAY[id.toUpperCase()] ?? id
}
import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { User } from '@/lib/types'

const ALL_MODULES = [
  { id: 'autocsv',    label: 'Auto CSV' },
  { id: 'qd',         label: 'UPC Scanner' },
  { id: 'reports',    label: 'Reports' },
  { id: 'season_ss',   label: 'SS Season' },
  { id: 'season_aw',   label: 'AW Season' },
  { id: 'season_book', label: 'Season Book' },
  { id: 'ic',          label: 'Infinity Classics' },
  { id: 'po_tracker',  label: 'PO Tracker' },
  { id: 'tasks',       label: 'Tasks' },
  { id: 'settings',    label: 'Settings' },
]

const DEFAULT_STORES = ['ALL','PO','HP1','HP2','HP3','COX','JCKSN','HB','KINGS','CONEY','SE13','TTC','TTP']
const LOCATIONS = ['Hosiery Plus','Tiptoe','Purple Orchid']
const DELETE_PASSWORD = 'star'

interface DBUser { id: string; userid: string; store: string; location: string; modules: string[] }
interface VendorRow { vendor_id: string; brand: string }
interface CtxMenu { x: number; y: number; kind: 'user'; userId: string }
interface VCtxMenu { x: number; y: number; kind: 'vendor'; idx: number }

const VENDOR_DATA_ORIG: VendorRow[] = [
  {vendor_id:"365",brand:"365"},
  {vendor_id:"10K",brand:"Cco Blanc"},
  {vendor_id:"12 Little",brand:"12 Little"},
  {vendor_id:"24/7",brand:"24/7"},
  {vendor_id:"2Dye4",brand:"2Dye4"},
  {vendor_id:"47Seventy",brand:"47Seventy"},
  {vendor_id:"7Thday",brand:"7Thday"},
  {vendor_id:"A Monday",brand:"A Monday"},
  {vendor_id:"A-Z",brand:"The Right Fit"},
  {vendor_id:"A-Z",brand:"Top Fit"},
  {vendor_id:"A.J Morgan",brand:"A.J Morgan"},
  {vendor_id:"A`Lapage",brand:"A`Lapage"},
  {vendor_id:"Abigail",brand:"Abigail"},
  {vendor_id:"Ada",brand:"Ada"},
  {vendor_id:"Aden+Anais",brand:"Aden + Anais"},
  {vendor_id:"Adora",brand:"Adora"},
  {vendor_id:"Adorna",brand:"Adorna"},
  {vendor_id:"Ahdorned",brand:"Ahdorned"},
  {vendor_id:"Aime Child",brand:"Aime Child"},
  {vendor_id:"AIR BANDANA",brand:"AIR BANDANA"},
  {vendor_id:"Alashan",brand:"Alashan"},
  {vendor_id:"Aleeza Paris",brand:"Aleeza Paris"},
  {vendor_id:"Alex Max",brand:"Alex Max"},
  {vendor_id:"Alice & Olivia",brand:"Alice & Olivia"},
  {vendor_id:"Alimrose",brand:"Alimrose"},
  {vendor_id:"Alisha D",brand:"Alisha D"},
  {vendor_id:"Alitsa",brand:"Alitsa"},
  {vendor_id:"Alix Fray",brand:"Alix Fray"},
  {vendor_id:"All Ruffled Up",brand:"All Ruffled Up"},
  {vendor_id:"Alla Berman",brand:"Alla Berman"},
  {vendor_id:"American Importers",brand:"American Importers"},
  {vendor_id:"American Importers",brand:"Lizi"},
  {vendor_id:"American Jewel",brand:"American Jewel"},
  {vendor_id:"Amour",brand:"Amour"},
  {vendor_id:"Amwear Sales Corp.",brand:"Rosette"},
  {vendor_id:"Amwear Sales Corp.",brand:"Coral"},
  {vendor_id:"Amwear Sales Corp.",brand:"Heiress"},
  {vendor_id:"Ana And Ava",brand:"Ana And Ava"},
  {vendor_id:"Ana And Ava",brand:"Ana and Ava x Tiptoe"},
  {vendor_id:"Anava Paris",brand:"Anava Paris"},
  {vendor_id:"Andorine",brand:"Andorine"},
  {vendor_id:"Anew",brand:"Anew"},
  {vendor_id:"Angelique De Paris",brand:"Angelique De Paris"},
  {vendor_id:"Anita International",brand:"Anita"},
  {vendor_id:"Anja Schwerbrock",brand:"Anja Schwerbrock"},
  {vendor_id:"Anne Klein",brand:"Anne Klein"},
  {vendor_id:"Antebies",brand:"Condor"},
  {vendor_id:"Antoinette Paris",brand:"Antoinette Paris"},
  {vendor_id:"Ao76",brand:"Ao76"},
  {vendor_id:"Appaman",brand:"Appaman"},
  {vendor_id:"Arabelle",brand:"Arabelle"},
  {vendor_id:"Argail",brand:"Argail"},
  {vendor_id:"Arics",brand:"Asher Fabrics"},
  {vendor_id:"Aris",brand:"Aleeza Paris"},
  {vendor_id:"Aritex",brand:"Crew"},
  {vendor_id:"Aritex",brand:"Kipp"},
  {vendor_id:"Aritex",brand:"Aritex"},
  {vendor_id:"Aritex",brand:"Klai"},
  {vendor_id:"Arsene",brand:"Arsene"},
  {vendor_id:"Artesania Carmina",brand:"Artesania Carmina"},
  {vendor_id:"Artis",brand:"Hamico"},
  {vendor_id:"Atelier Parsmei",brand:"Atelier Parsmei"},
  {vendor_id:"Atifa",brand:"Atifa"},
  {vendor_id:"Audrey Morris",brand:"Audrey Morris"},
  {vendor_id:"Aurora",brand:"Aurora"},
  {vendor_id:"Autumn Cashmere",brand:"Autumn Cashmere"},
  {vendor_id:"Avanti",brand:"Avanti"},
  {vendor_id:"Aw23 Pack Up",brand:"Early Sunday"},
  {vendor_id:"Awo24",brand:"Awo24"},
  {vendor_id:"Aymara",brand:"Aymara"},
  {vendor_id:"B-Low The Belt",brand:"B-Low The Belt"},
  {vendor_id:"B. Tiff",brand:"B. Tiff"},
  {vendor_id:"Babe And Tess",brand:"Babe And Tess"},
  {vendor_id:"Baby Brown",brand:"Baby Brown"},
  {vendor_id:"Baby Club Chic",brand:"Baby Club Chic"},
  {vendor_id:"Baby Dish",brand:"Baby Dish"},
  {vendor_id:"Baby Jar",brand:"Baby Jar"},
  {vendor_id:"Baby Jay",brand:"Baby Jar"},
  {vendor_id:"Baby Steps",brand:"Mish"},
  {vendor_id:"Baby Steps",brand:"Baby Steps"},
  {vendor_id:"Baby Steps",brand:"Little Mish"},
  {vendor_id:"Babyclic",brand:"Babyclic"},
  {vendor_id:"Babyo",brand:"Babyo"},
  {vendor_id:"Baje Studio",brand:"Baje"},
  {vendor_id:"Bandana Bliss",brand:"Bandana Bliss"},
  {vendor_id:"Bandeau",brand:"Bandeau"},
  {vendor_id:"Bandolier",brand:"Bandolier"},
  {vendor_id:"Barbara",brand:"Barbara"},
  {vendor_id:"Barbaras",brand:"Barbaras"},
  {vendor_id:"Bari Lynn",brand:"Bari Lynn"},
  {vendor_id:"Batsheva",brand:"Batsheva"},
  {vendor_id:"Bdaz",brand:"Bdaz"},
  {vendor_id:"Be",brand:"Bow & Teke"},
  {vendor_id:"Be For All",brand:"Be For All"},
  {vendor_id:"Beau Chic",brand:"Beau Chic"},
  {vendor_id:"Beau Loves",brand:"Beau Loves"},
  {vendor_id:"Beaux Bow",brand:"Beaux Bow"},
  {vendor_id:"Bebe",brand:"Bndoux Bebe"},
  {vendor_id:"Bebe Beaute",brand:"Bebe Beaute"},
  {vendor_id:"Bebe Belinha",brand:"Bebe Belinha"},
  {vendor_id:"Bebe Organic",brand:"Bebe Organic"},
  {vendor_id:"Bebe Sweeny",brand:"Bebe Sweeny"},
  {vendor_id:"Becca + Bella",brand:"Becca + Bella"},
  {vendor_id:"Bee And Dee",brand:"Bee And Dee"},
  {vendor_id:"Bella Rose",brand:"La Mascot"},
  {vendor_id:"Bella Tunno",brand:"Bella Tunno"},
  {vendor_id:"Bellabini",brand:"Bellabini"},
  {vendor_id:"Bellissibow",brand:"Bellissibow"},
  {vendor_id:"Bendon (Usa) Incorpo",brand:"Bendon"},
  {vendor_id:"Bene Bene",brand:"Bene Bene"},
  {vendor_id:"Berman",brand:"Berman"},
  {vendor_id:"Best Beanies",brand:"Best Beanies"},
  {vendor_id:"Best Frendz",brand:"Best Frendz"},
  {vendor_id:"Best Frendz",brand:"Cardlcq"},
  {vendor_id:"Best Frendz",brand:"Lone Feather"},
  {vendor_id:"Best Frendz",brand:"Smile Everyday"},
  {vendor_id:"Best Frendz",brand:"Child Play"},
  {vendor_id:"Best Frendz",brand:"Siccinino"},
  {vendor_id:"Best Frendz",brand:"Zaloo"},
  {vendor_id:"Best Frendz",brand:"Tikie Studio"},
  {vendor_id:"Best Frendz",brand:"C.T.N"},
  {vendor_id:"Best Frendz",brand:"The Mee Dress"},
  {vendor_id:"Best Frendz",brand:"Sister Fruit"},
  {vendor_id:"Best Frendz",brand:"Bzzy Style"},
  {vendor_id:"Best Frendz",brand:"Sciacca"},
  {vendor_id:"Best Frendz",brand:"Tikie Event"},
  {vendor_id:"Beyond Creations",brand:"Beyond Creations"},
  {vendor_id:"Beyond Rings",brand:"Beyond Rings"},
  {vendor_id:"Bezi From Edith`s",brand:"Bezi"},
  {vendor_id:"Bi",brand:"By The Wai"},
  {vendor_id:"Bibelot",brand:"Bibelot"},
  {vendor_id:"Bibs",brand:"Bibs X Liberty"},
  {vendor_id:"Billieblush",brand:"Billieblush"},
  {vendor_id:"Bird Rock Baby",brand:"Bird Rock Baby"},
  {vendor_id:"Birinit",brand:"Birinit"},
  {vendor_id:"Bitz Of Glitz",brand:"Bitz Of Glitz"},
  {vendor_id:"Blabla Kids",brand:"Blabla Kids"},
  {vendor_id:"Black Label",brand:"Black Label"},
  {vendor_id:"Blackspade",brand:"Blackspade"},
  {vendor_id:"Blanqi",brand:"Blanqi"},
  {vendor_id:"Bleu La La",brand:"Bleu La La"},
  {vendor_id:"Blinq",brand:"Babyo"},
  {vendor_id:"Blinq",brand:"Blinq"},
  {vendor_id:"Blinq",brand:"Bondoux"},
  {vendor_id:"Blinq Hosiery",brand:"Blinq Hosiery"},
  {vendor_id:"Blk&Whiteny",brand:"Blk&Whiteny"},
  {vendor_id:"Blue Heaven",brand:"Blue Heaven"},
  {vendor_id:"Blue Heaven",brand:"Filazi"},
  {vendor_id:"Blue Heaven",brand:"Sireco"},
  {vendor_id:"Blue Heaven",brand:"Fidenzze"},
  {vendor_id:"Blue Pacific",brand:"Blue Pacific"},
  {vendor_id:"Blue Sky Imports",brand:"Blue Sky"},
  {vendor_id:"Blue Willoe Candle",brand:"Blue Willoe Candle"},
  {vendor_id:"Blush Lingerie Inc+A",brand:"Blush"},
  {vendor_id:"Boardies",brand:"Boardies"},
  {vendor_id:"Bobbin & Tricot",brand:"Bobbin & Tricot"},
  {vendor_id:"Bobo Choses",brand:"Bobo Choses"},
  {vendor_id:"Boca Baby",brand:"Boca Baby"},
  {vendor_id:"Bon Rever",brand:"Bon Rever"},
  {vendor_id:"Bon`Ette",brand:"Bopop"},
  {vendor_id:"Bondoux",brand:"Bondoux"},
  {vendor_id:"Bondoux",brand:"Laylay"},
  {vendor_id:"Bonjour",brand:"Bonjour"},
  {vendor_id:"Bonjoy",brand:"Bonjoy"},
  {vendor_id:"Bonmot",brand:"Bonmot"},
  {vendor_id:"Bonnie Baby",brand:"Bonnie Baby"},
  {vendor_id:"Bonton",brand:"Bonton"},
  {vendor_id:"Booso",brand:"Booso"},
  {vendor_id:"Bopop",brand:"Bopop"},
  {vendor_id:"Bopop",brand:"Bonette"},
  {vendor_id:"Bopop",brand:"Ducc"},
  {vendor_id:"Bottleblond Jewels",brand:"Bottleblond"},
  {vendor_id:"Bows Arts",brand:"Bows Arts"},
  {vendor_id:"Bozkurt",brand:"Bozkurt"},
  {vendor_id:"Brach Knitting",brand:"Brach Knitting"},
  {vendor_id:"Briati",brand:"Briati"},
  {vendor_id:"Brown Denim",brand:"Brown Denim"},
  {vendor_id:"Brown Label",brand:"Brown Label"},
  {vendor_id:"Bs",brand:"Belle Vous"},
  {vendor_id:"Btb Los Angeles",brand:"Btb Los Angeles"},
  {vendor_id:"Btb Los Angeles",brand:"Jrp"},
  {vendor_id:"Bubba",brand:"Buuba"},
  {vendor_id:"Buho",brand:"Buho"},
  {vendor_id:"Bunny Love",brand:"Bunny Love"},
  {vendor_id:"Burlington",brand:"Interwoven"},
  {vendor_id:"Burlington",brand:"Burlington"},
  {vendor_id:"Buuba",brand:"Buuba"},
  {vendor_id:"By The Wai",brand:"By The Wai"},
  {vendor_id:"C",brand:"Cpak"},
  {vendor_id:"C.I. Ellipse S.A.",brand:"Ellipse"},
  {vendor_id:"C&C",brand:"Marmar"},
  {vendor_id:"C`Era Una Volta",brand:"C`Era Una Volta"},
  {vendor_id:"Cache Coeur",brand:"Cache"},
  {vendor_id:"Californian Vintage",brand:"Californian Vintage"},
  {vendor_id:"Californian Vintage",brand:"Calvin Klein"},
  {vendor_id:"Calvin Klein",brand:"Calvin Klein"},
  {vendor_id:"Calvin Klein",brand:"Tommy Hilfiger"},
  {vendor_id:"Cameo",brand:"Cameo"},
  {vendor_id:"Camille Kids",brand:"Ba Na"},
  {vendor_id:"Carbon Soldier",brand:"Carbon Soldier"},
  {vendor_id:"Careline",brand:"Careline"},
  {vendor_id:"Careline",brand:"Gade"},
  {vendor_id:"Careline",brand:"Chic"},
  {vendor_id:"Carlijnq",brand:"Carlijnq"},
  {vendor_id:"Carlomagno",brand:"Carlomagno"},
  {vendor_id:"Carnival",brand:"Carnival"},
  {vendor_id:"Carol Hochman Design",brand:"Carol Hochman"},
  {vendor_id:"Carolina Amato",brand:"Carolina Amato"},
  {vendor_id:"Catya",brand:"Catya"},
  {vendor_id:"Catya",brand:"Kopka"},
  {vendor_id:"Cc",brand:"Cco Blanc"},
  {vendor_id:"Cc",brand:"Maisonita"},
  {vendor_id:"Ccessories",brand:"Cherie Accessories"},
  {vendor_id:"Central Park West",brand:"Central Park West"},
  {vendor_id:"Ch Edith Lances Llc",brand:"Edith Lances"},
  {vendor_id:"Champion",brand:"Champion"},
  {vendor_id:"Chanabana",brand:"Chanabanana"},
  {vendor_id:"Chant De Joie",brand:"Chant De Joie"},
  {vendor_id:"Chantelle",brand:"Chantelle"},
  {vendor_id:"Chanteur",brand:"Chanteur"},
  {vendor_id:"Chantiques Showroom",brand:"Li & Me"},
  {vendor_id:"Charles Komar & Sons",brand:"Komar"},
  {vendor_id:"Cherie",brand:"Cherie"},
  {vendor_id:"Cherie",brand:"Cherie Accessories"},
  {vendor_id:"Childrenwear",brand:"Marmar"},
  {vendor_id:"Childrenwear",brand:"Ao76"},
  {vendor_id:"Christina Rohde",brand:"Christina Rohde"},
  {vendor_id:"Christina Rohde",brand:"Christina Rhode"},
  {vendor_id:"Christina Rohde",brand:"Olivia Rodhe"},
  {vendor_id:"Chupetin",brand:"Chupetin"},
  {vendor_id:"Ciao Milano",brand:"Ciao Milano"},
  {vendor_id:"Cindy Couture",brand:"Cindy Couture"},
  {vendor_id:"Citrine",brand:"Citrine"},
  {vendor_id:"Citrine",brand:"Poppeto"},
  {vendor_id:"Citrus Apparel",brand:"Citrus"},
  {vendor_id:"City Mouse",brand:"City Mouse"},
  {vendor_id:"Cjoie",brand:"Chant De Joie"},
  {vendor_id:"Ck Womens",brand:"Calvin Klein"},
  {vendor_id:"Classic Hosiery",brand:"Butterfly"},
  {vendor_id:"Classic Hosiery",brand:"Florence"},
  {vendor_id:"Classic Hosiery",brand:"Palm Kids"},
  {vendor_id:"Classic Hosiery",brand:"Classic"},
  {vendor_id:"Classic Lingerie",brand:"Pen-Ky"},
  {vendor_id:"Classy Paci",brand:"Classy Paci"},
  {vendor_id:"Claudia Driggs",brand:"Claudia Driggs"},
  {vendor_id:"Cloud + Coral",brand:"Cloud + Coral"},
  {vendor_id:"Cloudnine",brand:"Shayne Coat"},
  {vendor_id:"Coccoli",brand:"Coccoli"},
  {vendor_id:"Coco Au Lait",brand:"Coco Au Lait"},
  {vendor_id:"Coco Blanc",brand:"Coco Blanc"},
  {vendor_id:"Coconut Grove Pads I",brand:"Coconut Grove"},
  {vendor_id:"Cocoon",brand:"Cocoon"},
  {vendor_id:"Colmar",brand:"Colmar"},
  {vendor_id:"Colmar",brand:"Fyi"},
  {vendor_id:"Colors In Optics",brand:"Cco Blanc"},
  {vendor_id:"Colors In Optics",brand:"Colors In Optics"},
  {vendor_id:"Colossal Imports",brand:"Colossal"},
  {vendor_id:"Comfycubs",brand:"Comfycubs"},
  {vendor_id:"Commando",brand:"Commando"},
  {vendor_id:"Compania Fantastica",brand:"Compania Fantastica"},
  {vendor_id:"Complit",brand:"Complit"},
  {vendor_id:"Condor",brand:"Condor"},
  {vendor_id:"Condorella",brand:"Condorella"},
  {vendor_id:"Confetti",brand:"Confetti"},
  {vendor_id:"Congregation Batei S",brand:"Congregation"},
  {vendor_id:"Corjaclin",brand:"Firehouse"},
  {vendor_id:"Cos I Said So",brand:"Cos I Said So"},
  {vendor_id:"Cosabella",brand:"Cosabella"},
  {vendor_id:"Cosmosophie",brand:"Cosmosophie"},
  {vendor_id:"Coton Pompom",brand:"Coton Pompom"},
  {vendor_id:"Coton Pompom",brand:"Lyda Designs"},
  {vendor_id:"Cotton Bloom",brand:"Cotton Bloom"},
  {vendor_id:"Cottonwood",brand:"Cottonwood"},
  {vendor_id:"Cozmo",brand:"Cozmo"},
  {vendor_id:"Cozy Nest",brand:"Cozy Nest"},
  {vendor_id:"Creartive Spot",brand:"Creartive"},
  {vendor_id:"Creartive Spot",brand:"Creartive Spot"},
  {vendor_id:"Crew",brand:"Crew"},
  {vendor_id:"Crew",brand:"Kipp"},
  {vendor_id:"Cruz",brand:"Cruz"},
  {vendor_id:"Crystal Dream Baby",brand:"Crystal Dream Baby"},
  {vendor_id:"Cuddle And Coo",brand:"Cuddle & Coo"},
  {vendor_id:"Cuddle And Coo",brand:"Cuddle And Coo"},
  {vendor_id:"Cuddle And Coo",brand:"Panther"},
  {vendor_id:"Custom Maid",brand:"C.Maid"},
  {vendor_id:"Cutie",brand:"Cutie"},
  {vendor_id:"D",brand:"Dabbawalla"},
  {vendor_id:"D",brand:"Dlicat"},
  {vendor_id:"Dacee Designs",brand:"Dacee"},
  {vendor_id:"Dacee Designs",brand:"Revaz"},
  {vendor_id:"Dacee Designs",brand:"Its Younique"},
  {vendor_id:"Daisy Gift Box",brand:"Daisy Gift Box"},
  {vendor_id:"Dal Dosso",brand:"Dal Dosso"},
  {vendor_id:"Dandydill Way",brand:"Dandysill Way"},
  {vendor_id:"David",brand:"Mimixiong"},
  {vendor_id:"David",brand:"Null"},
  {vendor_id:"David",brand:"David"},
  {vendor_id:"Dayleen Intimates In",brand:"Dominique"},
  {vendor_id:"Dazzle",brand:"Dazzle"},
  {vendor_id:"Deepa Gurnani",brand:"Deepa Gurnani"},
  {vendor_id:"Delore",brand:"Delore"},
  {vendor_id:"Deluxe",brand:"Delino"},
  {vendor_id:"Deluxe Fashion Accen",brand:"Deluxe Fashion Accents"},
  {vendor_id:"Denali",brand:"Denali"},
  {vendor_id:"Deux Par Deux",brand:"Deux Par Deux"},
  {vendor_id:"Diesel",brand:"Diesel"},
  {vendor_id:"Dimpel",brand:"Dimpel"},
  {vendor_id:"Dkny",brand:"Dkny"},
  {vendor_id:"Dlite",brand:"Dlite"},
  {vendor_id:"Doll And Carl",brand:"Doll And Carl"},
  {vendor_id:"Domani Home",brand:"Domani Home"},
  {vendor_id:"Donna Karan",brand:"Donna Karan"},
  {vendor_id:"Donsje",brand:"Donsje"},
  {vendor_id:"Dott",brand:"Dott"},
  {vendor_id:"Dotties",brand:"Dotties"},
  {vendor_id:"Drivas",brand:"Dborah Grivas"},
  {vendor_id:"Duke And Port",brand:"Duke And Port"},
  {vendor_id:"E",brand:"Emi Jay"},
  {vendor_id:"Eaby",brand:"Eegant Baby"},
  {vendor_id:"Earbar",brand:"Earbar"},
  {vendor_id:"Earing Backs",brand:"Earing Backs"},
  {vendor_id:"Early Sunday",brand:"Early Sunday"},
  {vendor_id:"Eccomi",brand:"Eccomi"},
  {vendor_id:"Effiki",brand:"Effiki"},
  {vendor_id:"Eight + Nine",brand:"Eight + Nine"},
  {vendor_id:"Ela",brand:"Ela"},
  {vendor_id:"Elements",brand:"Elements"},
  {vendor_id:"Elila",brand:"Elila"},
  {vendor_id:"Elita",brand:"Elita"},
  {vendor_id:"Elk Wig Supply",brand:"Elk Wig Supply"},
  {vendor_id:"Ella and Rapha",brand:"Ella and Rapha"},
  {vendor_id:"Ella Int`L",brand:"Lipchic"},
  {vendor_id:"Ellabee",brand:"Ellabee"},
  {vendor_id:"Elle & Boo",brand:"Elle & Boo"},
  {vendor_id:"Elle Bee",brand:"Elle Bee"},
  {vendor_id:"Elle Mac",brand:"Elle Mac"},
  {vendor_id:"Ellen Tracy",brand:"Ellen Tracy"},
  {vendor_id:"Eloray",brand:"Eloray"},
  {vendor_id:"Ely Baby",brand:"Ely Baby"},
  {vendor_id:"Ely`s & Co",brand:"Ely`s & Co"},
  {vendor_id:"Ely`s & Co",brand:"Aurora"},
  {vendor_id:"Ely`s & Co",brand:"Hearts Of Yarn"},
  {vendor_id:"Emby Hosiery",brand:"Mod & Tone"},
  {vendor_id:"Emile et Ida",brand:"Emile & Ida"},
  {vendor_id:"Emile et Ida",brand:"Emile et Ida"},
  {vendor_id:"Ermanno Scervino",brand:"Ermanno Scervino"},
  {vendor_id:"Esatto",brand:"Esatto"},
  {vendor_id:"Escada",brand:"Escada"},
  {vendor_id:"Esme",brand:"Esme"},
  {vendor_id:"Esther",brand:"Esther"},
  {vendor_id:"Esther Rouimi",brand:"Esther Rouimi"},
  {vendor_id:"Etnia Barcelona",brand:"Etnia Barcelona"},
  {vendor_id:"Eve International",brand:"Ilusion"},
  {vendor_id:"Eveden Inc",brand:"Freya"},
  {vendor_id:"Eveden Inc",brand:"Elomi"},
  {vendor_id:"Evolove",brand:"Evolove"},
  {vendor_id:"Ezlastic",brand:"Ezlastic"},
  {vendor_id:"Ezlastic",brand:"Seams"},
  {vendor_id:"F",brand:"Fl Rose"},
  {vendor_id:"F",brand:"Fragile"},
  {vendor_id:"Fado",brand:"Fado"},
  {vendor_id:"Faire",brand:"Iscream"},
  {vendor_id:"Faire",brand:"Scent New York"},
  {vendor_id:"Faire",brand:"Gilbin"},
  {vendor_id:"Faire",brand:"Bows Arts"},
  {vendor_id:"Faire",brand:"Bebe Sweeny"},
  {vendor_id:"Faire",brand:"Sensibling Corp."},
  {vendor_id:"Faire",brand:"Kyte Baby"},
  {vendor_id:"Faire",brand:"Faire"},
  {vendor_id:"Fairwell",brand:"Fairwell"},
  {vendor_id:"Falke",brand:"Falke"},
  {vendor_id:"Fallon & Royce",brand:"Fallon & Royce"},
  {vendor_id:"Fame Accessories",brand:"Fame Accessories"},
  {vendor_id:"Famous Products",brand:"Famous Products"},
  {vendor_id:"Farren+Me",brand:"Farren+Me"},
  {vendor_id:"Fashion Angels",brand:"Fashion Angels"},
  {vendor_id:"Feather 4 Arrow",brand:"Feather 4 Arrow"},
  {vendor_id:"Feathers Usa",brand:"Feathers"},
  {vendor_id:"Felina",brand:"Felina"},
  {vendor_id:"Femtastic",brand:"Femtastic"},
  {vendor_id:"Finest Accessories",brand:"France Luxe"},
  {vendor_id:"Finest Accessories",brand:"Finest Accessories"},
  {vendor_id:"finest Accessories",brand:"The Finest Accessories"},
  {vendor_id:"Finest Accessories",brand:"The Animals Observatory"},
  {vendor_id:"Finestyle",brand:"Finestyle"},
  {vendor_id:"Finger In The Nose",brand:"Finger In The Nose"},
  {vendor_id:"Firehouse",brand:"Firehouse"},
  {vendor_id:"First Wholesale Ny",brand:"First Wholesale Ny"},
  {vendor_id:"Fit Rite",brand:"Fit Rite"},
  {vendor_id:"Fit Rite",brand:"Zehu"},
  {vendor_id:"Fit Rite",brand:"Sanremo"},
  {vendor_id:"Five Stars",brand:"Five Stars"},
  {vendor_id:"Flavia",brand:"Flavia"},
  {vendor_id:"Flora Nikrooz",brand:"Flora Nikrooz"},
  {vendor_id:"Floss",brand:"Floss"},
  {vendor_id:"Flowers By Zoe",brand:"Flowers By Zoe"},
  {vendor_id:"Flowers By Zoe",brand:"Global Love"},
  {vendor_id:"Fogal",brand:"Fogal"},
  {vendor_id:"Formentera",brand:"Formentera"},
  {vendor_id:"Fragile!",brand:"Fragile!"},
  {vendor_id:"Fragile!",brand:"Fragile"},
  {vendor_id:"Freida Rothman",brand:"Freida Rothman"},
  {vendor_id:"Frenchie Mini Coutur",brand:"Frenchie Mini Couture"},
  {vendor_id:"Freshly Picked",brand:"Freshly Picked"},
  {vendor_id:"Frigg",brand:"Frigg"},
  {vendor_id:"Froo",brand:"Froo"},
  {vendor_id:"Froo",brand:"Sweet Threads"},
  {vendor_id:"Froo",brand:"Prairie"},
  {vendor_id:"Froo",brand:"Sweet"},
  {vendor_id:"Froo",brand:"Soiree"},
  {vendor_id:"Fub",brand:"Fub"},
  {vendor_id:"Fyi",brand:"Fyi"},
  {vendor_id:"G Viteri",brand:"G Viteri"},
  {vendor_id:"G-Lish",brand:"G-Lish"},
  {vendor_id:"G. Nancy",brand:"G. Nancy"},
  {vendor_id:"G&S",brand:"G&S"},
  {vendor_id:"Gaby",brand:"Gaby"},
  {vendor_id:"Gaia",brand:"Gaia"},
  {vendor_id:"Galeez",brand:"Galeez"},
  {vendor_id:"Garment Group",brand:"Savile Row"},
  {vendor_id:"Garment Group",brand:"Ike Behar"},
  {vendor_id:"Garment Group",brand:"Rizzi"},
  {vendor_id:"Garment Group",brand:"Vannucci Couture"},
  {vendor_id:"Garment Group",brand:"Garment Group"},
  {vendor_id:"Garment Group",brand:"Vannucci Green"},
  {vendor_id:"Gemelli",brand:"Gemelli"},
  {vendor_id:"Gents",brand:"Gents"},
  {vendor_id:"Ghi Imports",brand:"Ghi Imports"},
  {vendor_id:"Gildan",brand:"Gildan"},
  {vendor_id:"Giovannio",brand:"Giovannio"},
  {vendor_id:"Glitter Nation",brand:"Glitter Nation"},
  {vendor_id:"Global Love",brand:"Global Love"},
  {vendor_id:"Glory",brand:"Glory"},
  {vendor_id:"Glu",brand:"Glu"},
  {vendor_id:"Go Couture",brand:"Go Couture"},
  {vendor_id:"Go Couture",brand:"The Slim Skirt"},
  {vendor_id:"Goddess",brand:"Goddess"},
  {vendor_id:"Goggle",brand:"Google"},
  {vendor_id:"Goody",brand:"Goody"},
  {vendor_id:"Green Marketing",brand:"Wet Brush"},
  {vendor_id:"Grenier",brand:"Grenier"},
  {vendor_id:"Haddad United",brand:"Totes"},
  {vendor_id:"Hair About Us",brand:"Hair About Us"},
  {vendor_id:"Hair About Us",brand:"Papillion"},
  {vendor_id:"Halfasquare",brand:"Halfasquare"},
  {vendor_id:"Hallow Berry",brand:"Hallow Berry"},
  {vendor_id:"Halo",brand:"Knot"},
  {vendor_id:"Halo",brand:"Halo"},
  {vendor_id:"Halo",brand:"Halo Luxe"},
  {vendor_id:"Halo Luxe",brand:"Halo Luxe"},
  {vendor_id:"Halo Luxe",brand:"Halo"},
  {vendor_id:"Hand Knits",brand:"Hand Knits"},
  {vendor_id:"Hanes",brand:"Hanes"},
  {vendor_id:"Hanes",brand:"Dkny"},
  {vendor_id:"Hanes Underwear",brand:"Hanes"},
  {vendor_id:"Haper James",brand:"Palid"},
  {vendor_id:"Haper James",brand:"Haper James"},
  {vendor_id:"Happy Socks",brand:"Happy Socks"},
  {vendor_id:"Hat Attack",brand:"Hat Attack"},
  {vendor_id:"Head Turner",brand:"Head Turner"},
  {vendor_id:"Hearts Of Yarn",brand:"Hearts Of Yarn"},
  {vendor_id:"Heartstrings Clips",brand:"Heartstring Clips"},
  {vendor_id:"Hebe",brand:"Hebe"},
  {vendor_id:"Heirlooms",brand:"Heirlooms"},
  {vendor_id:"Hello Lupo",brand:"Hello Lupo"},
  {vendor_id:"Hello Simone",brand:"Hello Simone"},
  {vendor_id:"Hello Yellow",brand:"Hello Yellow"},
  {vendor_id:"Heven",brand:"Heven"},
  {vendor_id:"Hey Kid",brand:"Hey Kid"},
  {vendor_id:"Hidenseek",brand:"Hidenseek"},
  {vendor_id:"High Fashion Handbag",brand:"High Fashion Handbags"},
  {vendor_id:"Hinterveld",brand:"Hinterveld"},
  {vendor_id:"Hipfits",brand:"Hipfits"},
  {vendor_id:"Hnana",brand:"Hannah Banana"},
  {vendor_id:"Honey Belle",brand:"Honey Belle"},
  {vendor_id:"Hp International",brand:"Goody"},
  {vendor_id:"Hp International",brand:"Sage"},
  {vendor_id:"Hp International",brand:"HEAD"},
  {vendor_id:"Hp International",brand:"Eden"},
  {vendor_id:"Hp International",brand:"Nino"},
  {vendor_id:"Hp International",brand:"Hp International"},
  {vendor_id:"Hp International",brand:"Maple"},
  {vendor_id:"Hp International",brand:"Tiny Cuddlez"},
  {vendor_id:"Hp International",brand:"Mini Pops"},
  {vendor_id:"Hp International",brand:"180S"},
  {vendor_id:"Hp International",brand:"Fownes Brothers"},
  {vendor_id:"Hp International",brand:"Stylin"},
  {vendor_id:"Hp International",brand:"Hopscotch"},
  {vendor_id:"Hp International",brand:"Norman Sales"},
  {vendor_id:"Hp International",brand:"Waterwize"},
  {vendor_id:"Hp International",brand:"Allary"},
  {vendor_id:"Hp International",brand:"G&S"},
  {vendor_id:"Hp International",brand:"Kai & Kelly"},
  {vendor_id:"Hp International",brand:"Hp Hair Accessories"},
  {vendor_id:"Hp International",brand:"Memoi"},
  {vendor_id:"Hp International",brand:"Covr"},
  {vendor_id:"Hp International",brand:"Wet Brush"},
  {vendor_id:"Hp International",brand:"Elledue"},
  {vendor_id:"Hp International",brand:"Malach"},
  {vendor_id:"Hp International",brand:"Tinuk"},
  {vendor_id:"Hp International",brand:"Belle Vous"},
  {vendor_id:"Hp International",brand:"Clarks"},
  {vendor_id:"Hp International",brand:"Ecco"},
  {vendor_id:"Hp International",brand:"Savewize"},
  {vendor_id:"Hp International",brand:"Comare"},
  {vendor_id:"Hp International",brand:"GOLDTOE"},
  {vendor_id:"Hp International",brand:"Maxi50"},
  {vendor_id:"Hp International",brand:"Degrees"},
  {vendor_id:"Hp International",brand:"Rockport"},
  {vendor_id:"Hp International",brand:"Ttb"},
  {vendor_id:"Hp International",brand:"Levante"},
  {vendor_id:"Hp International",brand:"Evri"},
  {vendor_id:"Hp International",brand:"YETHAN"},
  {vendor_id:"Hue",brand:"Hue"},
  {vendor_id:"Hue",brand:"Champion"},
  {vendor_id:"Hugo",brand:"Hugo"},
  {vendor_id:"Huxbaby",brand:"Huxbaby"},
  {vendor_id:"Ikippah",brand:"Ikippah"},
  {vendor_id:"Indee",brand:"Indee"},
  {vendor_id:"Infinity Classics",brand:"Memoi"},
  {vendor_id:"Infinity Classics",brand:"Levante"},
  {vendor_id:"Infinity Classics",brand:"Melas"},
  {vendor_id:"Infinity Classics",brand:"Collection"},
  {vendor_id:"Infinity Classics",brand:"MiniMoi"},
  {vendor_id:"Infinity Classics",brand:"Natori"},
  {vendor_id:"Infinity Classics",brand:"Slimme"},
  {vendor_id:"Infinity Classics",brand:"Spot-On"},
  {vendor_id:"Infinity Classics",brand:"Promo Memoi"},
  {vendor_id:"Infinity Classics",brand:"Wellfit"},
  {vendor_id:"Infinity Classics",brand:"Elledue"},
  {vendor_id:"inii+mini",brand:"inii+mini"},
  {vendor_id:"Intex",brand:"Intex"},
  {vendor_id:"Iscream",brand:"Iscream"},
  {vendor_id:"It`S In My Jeans",brand:"It`S In My Jeans"},
  {vendor_id:"Its Younique",brand:"Its Younique"},
  {vendor_id:"Jacadi",brand:"Jacadi"},
  {vendor_id:"Jack & Jill",brand:"Jack & Jill"},
  {vendor_id:"Jackie O`",brand:"Jackie O`"},
  {vendor_id:"Jacques Levine",brand:"Jacques Levine"},
  {vendor_id:"Jamari",brand:"Weekend House Kid"},
  {vendor_id:"Jamie",brand:"Jamie"},
  {vendor_id:"Jamie Kay",brand:"Jamie Kay"},
  {vendor_id:"Jane & Bleecker",brand:"Jane & Bleecker"},
  {vendor_id:"Jaybeechild",brand:"Jaybeechild"},
  {vendor_id:"Jb London",brand:"Jb London"},
  {vendor_id:"Jefferies",brand:"Jefferies"},
  {vendor_id:"Jelly Bean",brand:"Jelly Bean"},
  {vendor_id:"Jessie And James",brand:"Jessie And James"},
  {vendor_id:"Jeweliette Jewels",brand:"Jeweliette Jewels"},
  {vendor_id:"Jnby",brand:"Jnby"},
  {vendor_id:"Jocelyn",brand:"Jocelyn"},
  {vendor_id:"Jocelyn",brand:"Happy Socks"},
  {vendor_id:"Jocelyn",brand:"Jockey"},
  {vendor_id:"Jockey International",brand:"Jockey"},
  {vendor_id:"John Richmond",brand:"John Richmond"},
  {vendor_id:"Jolie Enfants",brand:"Jolie Enfants"},
  {vendor_id:"Jones New York",brand:"Jones"},
  {vendor_id:"Josie Division Of Da",brand:"Josie"},
  {vendor_id:"Jrp",brand:"Jrp"},
  {vendor_id:"Jrp",brand:"Joropo"},
  {vendor_id:"Jrp",brand:"Soft & Snuggly"},
  {vendor_id:"Julie & Judah",brand:"Julie & Judah"},
  {vendor_id:"Junee",brand:"Hello Yellow"},
  {vendor_id:"Junee",brand:"Papillon"},
  {vendor_id:"Junee",brand:"Cabana"},
  {vendor_id:"Junee",brand:"Phil And Phoebe"},
  {vendor_id:"Junee",brand:"Minimal"},
  {vendor_id:"Junee",brand:"Vibe"},
  {vendor_id:"Junee",brand:"Harper James"},
  {vendor_id:"Junee",brand:"Mallory and Merlot"},
  {vendor_id:"Junee",brand:"Lilou"},
  {vendor_id:"Junee",brand:"One Child"},
  {vendor_id:"Junee",brand:"Duke and Port"},
  {vendor_id:"Junee",brand:"Tustello"},
  {vendor_id:"Junee",brand:"Jay Basic"},
  {vendor_id:"Junee",brand:"Slate"},
  {vendor_id:"Junee",brand:"Honest Edit"},
  {vendor_id:"Kai & Kelly",brand:"Kai & Kelly"},
  {vendor_id:"Kalinka",brand:"Kalinka"},
  {vendor_id:"Karl Lagerfeld",brand:"Karl Lagerfeld"},
  {vendor_id:"Karmela",brand:"Karmela"},
  {vendor_id:"Kaye Larcky Llc",brand:"Abergele"},
  {vendor_id:"Keep It Simple",brand:"Keep It Simple"},
  {vendor_id:"Kenz Kustomz",brand:"Kenz Kustomz"},
  {vendor_id:"Keter Judaica",brand:"Keter"},
  {vendor_id:"Keter Judaica",brand:"Null"},
  {vendor_id:"Kidiwi",brand:"Kidiwi"},
  {vendor_id:"Kids Basic",brand:"Kids Basic"},
  {vendor_id:"Kids On The Moon",brand:"Kids On The Moon"},
  {vendor_id:"Kiki Riki",brand:"Kiki Riki"},
  {vendor_id:"Kikio",brand:"2 Squares"},
  {vendor_id:"Kikio",brand:"Whipped Cocoa"},
  {vendor_id:"Kikio",brand:"Bebe Bella"},
  {vendor_id:"Kikio",brand:"5 Stars"},
  {vendor_id:"Kikio",brand:"Abigail"},
  {vendor_id:"Kikio",brand:"Cl\u00f4"},
  {vendor_id:"Kikio",brand:"Noni"},
  {vendor_id:"Kikio",brand:"Peek a boo"},
  {vendor_id:"Kikio",brand:"Five Stars"},
  {vendor_id:"Kikio",brand:"Fragile"},
  {vendor_id:"Kikio",brand:"Fyi"},
  {vendor_id:"Kikio",brand:"Noir by Mocha Noir"},
  {vendor_id:"Kikio",brand:"Unclear"},
  {vendor_id:"Kikio",brand:"Hopscotch"},
  {vendor_id:"Kikio",brand:"Ikippah"},
  {vendor_id:"Kikio",brand:"Bla Bla Bla"},
  {vendor_id:"Kikio",brand:"Kikio"},
  {vendor_id:"Kikio",brand:"Brb"},
  {vendor_id:"Kikio",brand:"Cindy Couture"},
  {vendor_id:"Kikio",brand:"Little Fragile"},
  {vendor_id:"Kikio",brand:"Lux"},
  {vendor_id:"Kikio",brand:"Neuf 9"},
  {vendor_id:"Kikio",brand:"Lola"},
  {vendor_id:"Kikio",brand:"Charlotte & George"},
  {vendor_id:"Kikio",brand:"Cia"},
  {vendor_id:"Kikio",brand:"Clo"},
  {vendor_id:"Kikio",brand:"Pinky Promise"},
  {vendor_id:"Kikio",brand:"Elle & Boo"},
  {vendor_id:"Kikio",brand:"Puddles"},
  {vendor_id:"Kikio",brand:"Peek-A-Boo"},
  {vendor_id:"Kikio",brand:"Apricot"},
  {vendor_id:"Kikio",brand:"Mr. Mr."},
  {vendor_id:"Kikio",brand:"Seal"},
  {vendor_id:"Kikio",brand:"Space Grey"},
  {vendor_id:"Kikio",brand:"Sunburnt"},
  {vendor_id:"Kikio",brand:"Noni Daily"},
  {vendor_id:"Kikio",brand:"Small Moments"},
  {vendor_id:"Kikio",brand:"So What"},
  {vendor_id:"Kikio",brand:"So Loved"},
  {vendor_id:"Kikio",brand:"Ginger"},
  {vendor_id:"Kikio",brand:"Cindy"},
  {vendor_id:"Kikio",brand:"Mocha Noir"},
  {vendor_id:"Kikio",brand:"Mocha"},
  {vendor_id:"Kikio",brand:"Try"},
  {vendor_id:"Kikio",brand:"Vivid"},
  {vendor_id:"Kikio",brand:"The Norway Club"},
  {vendor_id:"Kikio",brand:"Miumax"},
  {vendor_id:"Kikio",brand:"Mademoiselle"},
  {vendor_id:"Kikio",brand:"Jolie Capri"},
  {vendor_id:"Kikio",brand:"Maxmrkt"},
  {vendor_id:"Kikio",brand:"Lil Jogger"},
  {vendor_id:"Kikio",brand:"Lollypop"},
  {vendor_id:"Kikio",brand:"2 Squares 2 Squares"},
  {vendor_id:"Kikio",brand:"High 5"},
  {vendor_id:"Kikio",brand:"Monte Carlo"},
  {vendor_id:"Kikio",brand:"Hopscotch Script"},
  {vendor_id:"Kikio",brand:"Aspect"},
  {vendor_id:"Kikio",brand:"Nox-Ny (Teen)"},
  {vendor_id:"Kikio",brand:"Joie De Vivre"},
  {vendor_id:"Kikio",brand:"Milk"},
  {vendor_id:"Kikio",brand:"Sofia Rye"},
  {vendor_id:"Kikio",brand:"Lux Baby"},
  {vendor_id:"Kikio",brand:"LUX Regular"},
  {vendor_id:"Kikio",brand:"Riff (Print)"},
  {vendor_id:"Kikio",brand:"Birch"},
  {vendor_id:"Kikio",brand:"Nyc Factory"},
  {vendor_id:"Kikio",brand:"Samuel Jr"},
  {vendor_id:"Kikio",brand:"Versatile"},
  {vendor_id:"Kikio",brand:"Posie & Pistachio"},
  {vendor_id:"Kikio",brand:"24/7"},
  {vendor_id:"Kikio",brand:"Milan Italy"},
  {vendor_id:"Kikio",brand:"Oops"},
  {vendor_id:"Kikio",brand:"Blue Maple"},
  {vendor_id:"Kikio",brand:"Marjun"},
  {vendor_id:"Kikio",brand:"Spades"},
  {vendor_id:"Kikio",brand:"Coco"},
  {vendor_id:"Kikio",brand:"Buhu"},
  {vendor_id:"Kikio",brand:"Faves"},
  {vendor_id:"Kikio",brand:"E.U.X. Exclusive"},
  {vendor_id:"Kikio",brand:"Juli"},
  {vendor_id:"Kikio",brand:"Diciannove"},
  {vendor_id:"Kikio",brand:"Coco De La Mour"},
  {vendor_id:"Kikio",brand:"Midi"},
  {vendor_id:"Kikio",brand:"Qew"},
  {vendor_id:"Kikio",brand:"Riff"},
  {vendor_id:"Kikio",brand:"Birt Uk"},
  {vendor_id:"Kin+Kin",brand:"Kin+Kin"},
  {vendor_id:"Kipp",brand:"Kipp"},
  {vendor_id:"Kipp",brand:"Crew"},
  {vendor_id:"Kleinert",brand:"Kleinert"},
  {vendor_id:"Klienerts",brand:"Kleinerts"},
  {vendor_id:"Knit Planet",brand:"Knit Planet"},
  {vendor_id:"Knititude",brand:"Knititude"},
  {vendor_id:"Knot",brand:"Knot"},
  {vendor_id:"Koalav",brand:"Koalav"},
  {vendor_id:"Kokori",brand:"Kokori"},
  {vendor_id:"Komar Intimated Llc",brand:"Komar"},
  {vendor_id:"Konges Slojd",brand:"Konges Slojd"},
  {vendor_id:"Kopka",brand:"Kopka"},
  {vendor_id:"Kyte Baby",brand:"Kyte Baby"},
  {vendor_id:"L",brand:"Le Enfant"},
  {vendor_id:"L By Ladida",brand:"L By Ladida"},
  {vendor_id:"L Lady",brand:"L Lady"},
  {vendor_id:"L`Ovedbaby",brand:"L`Ovedbaby"},
  {vendor_id:"La Whisper",brand:"Ellwi"},
  {vendor_id:"Ladida",brand:"Ladida"},
  {vendor_id:"Ladida",brand:"Ava and Lu"},
  {vendor_id:"Ladida",brand:"L By Ladida"},
  {vendor_id:"Ladida",brand:"Elements"},
  {vendor_id:"Ladida",brand:"A4"},
  {vendor_id:"Ladida",brand:"Darlin"},
  {vendor_id:"Lady Burd",brand:"Lady Burd"},
  {vendor_id:"Laki Naturals",brand:"Laki Naturals"},
  {vendor_id:"Lalou",brand:"Lalou"},
  {vendor_id:"Latitta",brand:"Latitta"},
  {vendor_id:"Latte",brand:"Latte"},
  {vendor_id:"Le Bon Shoppe",brand:"Le Bon Shoppe"},
  {vendor_id:"Le Elephant",brand:"Le Enfant"},
  {vendor_id:"Le Enfant",brand:"Le Enfant"},
  {vendor_id:"Le Mystere",brand:"Le Mystere"},
  {vendor_id:"Le Petit Chapeau",brand:"Le Petit Chapeau"},
  {vendor_id:"Le Petit Coco",brand:"Le Petit Coco"},
  {vendor_id:"Ledum",brand:"Ledum"},
  {vendor_id:"Lejaby",brand:"Lejaby"},
  {vendor_id:"Les Coyotes",brand:"Les Coyotes"},
  {vendor_id:"Les Lutins",brand:"Les Lutins"},
  {vendor_id:"Lgns",brand:"Coton Pompom"},
  {vendor_id:"Li & Me",brand:"Li & Me"},
  {vendor_id:"Li & Me",brand:"Chantiques Corp"},
  {vendor_id:"Libby",brand:"Wigluxure"},
  {vendor_id:"Light+Nine",brand:"Light+Nine"},
  {vendor_id:"Liilu Organic",brand:"Liilu Organic"},
  {vendor_id:"Lil Charms",brand:"Lil Charms"},
  {vendor_id:"Lil Legs",brand:"Lil Legs"},
  {vendor_id:"Lil Legs",brand:"Lilette"},
  {vendor_id:"Lil Legs",brand:"Analogie"},
  {vendor_id:"Lil Teddy",brand:"Lil Teddy"},
  {vendor_id:"Lilac Designz",brand:"Lilac Designz"},
  {vendor_id:"Lilette",brand:"Lilette"},
  {vendor_id:"Lilies & Roses",brand:"Lilies & Roses"},
  {vendor_id:"Lilies Roses",brand:"Lilies & Roses"},
  {vendor_id:"Lilly Of France",brand:"Lilly Of France"},
  {vendor_id:"Lilou",brand:"Lilou"},
  {vendor_id:"Lily By Lou",brand:"Wolford"},
  {vendor_id:"Lilyette",brand:"Lilyette"},
  {vendor_id:"Limited Edition Ny",brand:"Limited Edition"},
  {vendor_id:"Limited Edition Ny",brand:"Limited Edition Ny"},
  {vendor_id:"Lison Paris",brand:"Lison Paris"},
  {vendor_id:"Little Creative Fact",brand:"Little Creative Factory"},
  {vendor_id:"Little Gems",brand:"Little Gems"},
  {vendor_id:"Little Gems Inc.",brand:"C.Maid"},
  {vendor_id:"Little Gems Inc.",brand:"Gemsli"},
  {vendor_id:"Little Label",brand:"Little Label"},
  {vendor_id:"Little Man Happy",brand:"Little Man Happy"},
  {vendor_id:"Little Noah",brand:"Little Noah"},
  {vendor_id:"Little Parni",brand:"Little Parni"},
  {vendor_id:"Little Printed",brand:"Little Printed"},
  {vendor_id:"Little Tempest",brand:"Little Tempest"},
  {vendor_id:"Little Threads",brand:"Little Threads"},
  {vendor_id:"Little Threads",brand:"Sweet Bamboo"},
  {vendor_id:"Liz",brand:"Liz"},
  {vendor_id:"Liza Schwartz",brand:"Liza Schwartz"},
  {vendor_id:"Lmn3",brand:"Lmn3"},
  {vendor_id:"Lola",brand:"Lola"},
  {vendor_id:"Lollypop",brand:"Lollypop"},
  {vendor_id:"Looms",brand:"Looms"},
  {vendor_id:"Losan",brand:"Losan"},
  {vendor_id:"Lotiekids",brand:"Lotiekids"},
  {vendor_id:"Loud",brand:"Loud"},
  {vendor_id:"Louis Louise",brand:"Louis Louise"},
  {vendor_id:"Louis Louise",brand:"Louis & Louise"},
  {vendor_id:"Louise Misha",brand:"Louise Misha"},
  {vendor_id:"Louisella",brand:"Louisella"},
  {vendor_id:"Louisiella",brand:"Louisiella"},
  {vendor_id:"Louisiella",brand:"Louisella"},
  {vendor_id:"Louse Misha",brand:"Louise Misha"},
  {vendor_id:"Loved Baby",brand:"Loved Baby"},
  {vendor_id:"LRDM",brand:"LRDM"},
  {vendor_id:"Luna Fresa",brand:"Luna Fresa"},
  {vendor_id:"Lyda Designs",brand:"Tiptoe Baby"},
  {vendor_id:"Lyda Designs",brand:"Coton Pompom"},
  {vendor_id:"Lyda Designs",brand:"Lydababy"},
  {vendor_id:"Lyda Designs",brand:"Tiptoe Boutique"},
  {vendor_id:"Lyda Designs",brand:"Cotton Bloom"},
  {vendor_id:"Lyda Designs",brand:"Lyda Designs"},
  {vendor_id:"Lydababy",brand:"Lydababy"},
  {vendor_id:"M & M Headwear",brand:"M & M Headwear"},
  {vendor_id:"m judaica",brand:"M Judaica"},
  {vendor_id:"M&S Canada Basic",brand:"Monte Kids"},
  {vendor_id:"M&S Canada Basic",brand:"Monte Carlo"},
  {vendor_id:"M&S Canada Basic",brand:"M&S Canada Basic"},
  {vendor_id:"Maan",brand:"Maan"},
  {vendor_id:"Mabli",brand:"Mabli"},
  {vendor_id:"Mad Pax",brand:"Mad Pax"},
  {vendor_id:"Magnolia Baby",brand:"Magnolia Baby"},
  {vendor_id:"Maillot Swim",brand:"Maillot Swim"},
  {vendor_id:"Maison Tadaboum",brand:"Maison Tadaboum"},
  {vendor_id:"Malabar",brand:"Malabar"},
  {vendor_id:"Malibu Luxxe",brand:"Malibu Luxxe"},
  {vendor_id:"Malibu Sugar",brand:"Malibu Sugar"},
  {vendor_id:"Mally Designs",brand:"Mally Designs"},
  {vendor_id:"Maniere",brand:"Maniere"},
  {vendor_id:"Maniere",brand:"Noovel"},
  {vendor_id:"Maniere",brand:"Montee"},
  {vendor_id:"Manteau",brand:"Manteau"},
  {vendor_id:"Mantel",brand:"Ritz"},
  {vendor_id:"Manuell & Frank",brand:"Manuell & Frank"},
  {vendor_id:"Mar Y Sol",brand:"Mar Y Sol"},
  {vendor_id:"Marcus Adler",brand:"Marcus Adler"},
  {vendor_id:"Marcus Adler",brand:"Null"},
  {vendor_id:"Marie Raxevsky",brand:"Marie Raxevsky"},
  {vendor_id:"Marilan",brand:"Marilan"},
  {vendor_id:"Marlo Kids",brand:"Marlo Kids"},
  {vendor_id:"Marmar",brand:"Marmar"},
  {vendor_id:"Mary Frances",brand:"Mary Frances"},
  {vendor_id:"Masterko",brand:"Peony"},
  {vendor_id:"Materia Design",brand:"Materia Design"},
  {vendor_id:"Max & Co",brand:"Max & Co"},
  {vendor_id:"Maybe4Baby",brand:"Maybe4Baby"},
  {vendor_id:"Mayer Berkshire",brand:"Berkshire"},
  {vendor_id:"Mayim",brand:"Mayim"},
  {vendor_id:"Meia Pata",brand:"Meia Pata"},
  {vendor_id:"Melina`S Bowtique",brand:"Melina"},
  {vendor_id:"Melina`S Bowtique",brand:"Melina`S Bowtique"},
  {vendor_id:"Melissa Lovy",brand:"Melissa Lovy"},
  {vendor_id:"Mema Knits",brand:"Mema Knits"},
  {vendor_id:"Meme Apparel",brand:"Hatch`D"},
  {vendor_id:"Mi Loves",brand:"Mi Loves"},
  {vendor_id:"Mika & Milo",brand:"Mika & Milo"},
  {vendor_id:"Miki Miette",brand:"Miki Miette"},
  {vendor_id:"Milano",brand:"Milano"},
  {vendor_id:"Milibo",brand:"Milibo"},
  {vendor_id:"Millianna",brand:"Millianna"},
  {vendor_id:"Mimapi",brand:"Mimapi"},
  {vendor_id:"Mini Donna",brand:"Mini Donna"},
  {vendor_id:"Mini Rodini",brand:"Mini Rodini"},
  {vendor_id:"Minikid",brand:"Minikid"},
  {vendor_id:"Minilabel",brand:"Minilabel"},
  {vendor_id:"Miocotton",brand:"Miocotton"},
  {vendor_id:"Mipounet",brand:"Mipounet"},
  {vendor_id:"MISC",brand:"MISC"},
  {vendor_id:"Mish",brand:"Mish"},
  {vendor_id:"Mish",brand:"Little Mish"},
  {vendor_id:"Misha & Puff",brand:"Misha & Puff"},
  {vendor_id:"Miss Begonia",brand:"Miss Begonia"},
  {vendor_id:"Miss Mini",brand:"Miss Mini"},
  {vendor_id:"Missoni",brand:"Missoni"},
  {vendor_id:"Mocha Noir",brand:"Mocha Noir"},
  {vendor_id:"Modital Bijoux",brand:"Modital Bijoux"},
  {vendor_id:"Moi",brand:"Moi"},
  {vendor_id:"Momohanipopo",brand:"Momohanipopo"},
  {vendor_id:"Mon Amie Kids",brand:"Mon Amie Kids"},
  {vendor_id:"Mon Cheri",brand:"Mon Cheri"},
  {vendor_id:"Mon Tresor",brand:"Mon Tresor"},
  {vendor_id:"Monnalisa",brand:"Monnalisa"},
  {vendor_id:"Monte Carlo",brand:"Monte Carlo"},
  {vendor_id:"Montelle Intimates I",brand:"Fleur`t"},
  {vendor_id:"Montelle Intimates I",brand:"Montelle"},
  {vendor_id:"Montelle Intimates I",brand:"Rya"},
  {vendor_id:"Morley",brand:"Morley"},
  {vendor_id:"Moschino",brand:"Moschino"},
  {vendor_id:"Motu Boys",brand:"Motu Boys"},
  {vendor_id:"Munsterkids",brand:"Munsterkids"},
  {vendor_id:"Mushie",brand:"Mushie"},
  {vendor_id:"Mushie",brand:"Frigg"},
  {vendor_id:"My Little Jewel",brand:"My Little Jewel"},
  {vendor_id:"My Memi",brand:"My Memi"},
  {vendor_id:"N/A",brand:"Shell Shock"},
  {vendor_id:"N/A",brand:"Gc"},
  {vendor_id:"N/A",brand:"N/A"},
  {vendor_id:"N\u00b021",brand:"N\u00b021"},
  {vendor_id:"Nahmu Bo Kim Manage",brand:"Bryant Brant"},
  {vendor_id:"Naked",brand:"Naked"},
  {vendor_id:"Namjosh",brand:"Namjosh"},
  {vendor_id:"Nanan",brand:"Nanan"},
  {vendor_id:"Natori",brand:"Natori"},
  {vendor_id:"Navon Cherry Cherry",brand:"You"},
  {vendor_id:"Navon Cherry Cherry",brand:"Dorina"},
  {vendor_id:"Negative Inventory",brand:"Analogie"},
  {vendor_id:"Negative Inventory",brand:"Calvin Klein"},
  {vendor_id:"Negative Inventory",brand:"Donna Karan"},
  {vendor_id:"Negative Inventory",brand:"Lil Legs"},
  {vendor_id:"Negative Inventory",brand:"Hue"},
  {vendor_id:"Negative Inventory",brand:"Teela"},
  {vendor_id:"Nessi Byrd",brand:"Nessi Byrd"},
  {vendor_id:"Nicsessories",brand:"Nicsessories"},
  {vendor_id:"Nicsessories",brand:"Nicsessories X Tiptoe"},
  {vendor_id:"Nicsessories",brand:"Noggi"},
  {vendor_id:"Nicsessories",brand:"Halfasquare"},
  {vendor_id:"Nikki Joy",brand:"Knititude"},
  {vendor_id:"Ninetwofive",brand:"Ninetwofive"},
  {vendor_id:"Ninventory",brand:"Kin+Kin"},
  {vendor_id:"Ninventory",brand:"Knot"},
  {vendor_id:"Ninventory",brand:"Kyte Baby"},
  {vendor_id:"Ninventory",brand:"Lil Legs"},
  {vendor_id:"Ninventory",brand:"Null"},
  {vendor_id:"Ninventory",brand:"Regina"},
  {vendor_id:"Ninventory",brand:"Tal"},
  {vendor_id:"Ninventory",brand:"Bee And Dee"},
  {vendor_id:"Ninventory",brand:"Coton Pompom"},
  {vendor_id:"Ninventory",brand:"Analogie"},
  {vendor_id:"Ninventory",brand:"Maniere"},
  {vendor_id:"Ninventory",brand:"Project 6"},
  {vendor_id:"Ninventory",brand:"Bandeau"},
  {vendor_id:"Ninventory",brand:"Weekend House Kid"},
  {vendor_id:"Ninventory",brand:"Yporque"},
  {vendor_id:"Ninventory",brand:"Calvin Klein"},
  {vendor_id:"Ninventory",brand:"Citrine"},
  {vendor_id:"Ninventory",brand:"Commando"},
  {vendor_id:"Ninventory",brand:"Crew"},
  {vendor_id:"Ninventory",brand:"Cuddle And Coo"},
  {vendor_id:"Ninventory",brand:"Fragile"},
  {vendor_id:"Ninventory",brand:"Je Sports"},
  {vendor_id:"Ninventory",brand:"Little Parni"},
  {vendor_id:"Ninventory",brand:"Lydababy"},
  {vendor_id:"Ninventory",brand:"Montee"},
  {vendor_id:"Ninventory",brand:"Pouf"},
  {vendor_id:"Ninventory",brand:"Scotch Bonnet"},
  {vendor_id:"Ninventory",brand:"American Importers"},
  {vendor_id:"Ninventory",brand:"Kids On The Moon"},
  {vendor_id:"Ninventory",brand:"Kipp"},
  {vendor_id:"Ninventory",brand:"Saranoni"},
  {vendor_id:"Ninventory",brand:"Wauw Capow"},
  {vendor_id:"Ninventory",brand:"Bri Lynn"},
  {vendor_id:"Ninventory",brand:"Coccoli"},
  {vendor_id:"Ninventory",brand:"Dacee"},
  {vendor_id:"Ninventory",brand:"Flowers By Zoe"},
  {vendor_id:"Ninventory",brand:"Arabelle"},
  {vendor_id:"Ninventory",brand:"Morley"},
  {vendor_id:"Ninventory",brand:"Pequeno Tocon"},
  {vendor_id:"Ninventory",brand:"Teela"},
  {vendor_id:"Ninventory",brand:"Alitsa"},
  {vendor_id:"Ninventory",brand:"Three Hearts"},
  {vendor_id:"Ninventory",brand:"Best Beanies"},
  {vendor_id:"Ninventory",brand:"Bows Arts"},
  {vendor_id:"Ninventory",brand:"Carbon Soldier"},
  {vendor_id:"Ninventory",brand:"Hue"},
  {vendor_id:"Ninventory",brand:"Klai"},
  {vendor_id:"Ninventory",brand:"Mocha Noir"},
  {vendor_id:"Ninventory",brand:"Sweet Threads"},
  {vendor_id:"Ninventory",brand:"Berkshire"},
  {vendor_id:"Ninventory",brand:"Cco Blanc"},
  {vendor_id:"Ninventory",brand:"Limited Edition"},
  {vendor_id:"Ninventory",brand:"Blinq"},
  {vendor_id:"Ninventory",brand:"Esme"},
  {vendor_id:"Ninventory",brand:"Sweet Bamboo"},
  {vendor_id:"Ninventory",brand:"Memoi"},
  {vendor_id:"Ninventory",brand:"Donna Karan"},
  {vendor_id:"Ninventory",brand:"Fyi"},
  {vendor_id:"Ninventory",brand:"Halo Luxe"},
  {vendor_id:"Ninventory",brand:"Little Man Happy"},
  {vendor_id:"Ninventory",brand:"Loved Baby"},
  {vendor_id:"Ninventory",brand:"Steph"},
  {vendor_id:"Ninventory",brand:"Tocoto Vintage"},
  {vendor_id:"Ninventory",brand:"Aleeza Paris"},
  {vendor_id:"Ninventory",brand:"Rock Your Kid"},
  {vendor_id:"Ninventory",brand:"Twinset"},
  {vendor_id:"Ninventory",brand:"The Finest Accessories"},
  {vendor_id:"Ninventory",brand:"Urbani"},
  {vendor_id:"Ninventory",brand:"Lola"},
  {vendor_id:"Ninventory",brand:"Beau Loves"},
  {vendor_id:"Ninventory",brand:"Huxbaby"},
  {vendor_id:"Ninventory",brand:"Milk"},
  {vendor_id:"Ninventory",brand:"Mish"},
  {vendor_id:"Ninventory",brand:"Posh Peanut"},
  {vendor_id:"Ninventory",brand:"Two Squares"},
  {vendor_id:"Nite-N-Gal",brand:"Nite-N-Gal"},
  {vendor_id:"Noggi",brand:"Noggi"},
  {vendor_id:"Noname",brand:"Noname"},
  {vendor_id:"Noodles & Boo",brand:"Noodles & Boo"},
  {vendor_id:"Noomie",brand:"Noomie"},
  {vendor_id:"Norman Sales",brand:"Goody"},
  {vendor_id:"Norman Sales",brand:"Eden"},
  {vendor_id:"Norman Sales",brand:"Stylin"},
  {vendor_id:"Norman Sales",brand:"Null"},
  {vendor_id:"Nueces",brand:"Nueces"},
  {vendor_id:"Nueces",brand:"Suncracy"},
  {vendor_id:"Null",brand:"Bonjoy"},
  {vendor_id:"Null",brand:"Tartine Et Chocolat"},
  {vendor_id:"Null",brand:"Moschino"},
  {vendor_id:"Null",brand:"Petit Piao"},
  {vendor_id:"Nununu",brand:"Nununu"},
  {vendor_id:"Nupkeet",brand:"Nupkeet"},
  {vendor_id:"O.B Designs",brand:"O.B Designs"},
  {vendor_id:"O.B Designs",brand:"Oh Baby!"},
  {vendor_id:"Oh Baby!",brand:"Oh Baby!"},
  {vendor_id:"Oilily",brand:"Oilily"},
  {vendor_id:"Olga Valentine",brand:"Olga Valentine"},
  {vendor_id:"Olivia Rohde",brand:"Olivia Rodhe"},
  {vendor_id:"Olivia Rohde",brand:"Olivia Rohde"},
  {vendor_id:"Omami Mini",brand:"Omami Mini"},
  {vendor_id:"On Gossamer",brand:"On Gossamer"},
  {vendor_id:"On Your Toes",brand:"On Your Toes"},
  {vendor_id:"Oubon",brand:"Oubon"},
  {vendor_id:"Oxox Club",brand:"Oxox Club"},
  {vendor_id:"P.Donna",brand:"Prima Donna"},
  {vendor_id:"Paige Lauren",brand:"Paige Lauren"},
  {vendor_id:"Paisley",brand:"Paisley"},
  {vendor_id:"Pakemelon",brand:"Pakemelon"},
  {vendor_id:"Panache Lingerie",brand:"Panache"},
  {vendor_id:"Paper Cape",brand:"Paper Cape"},
  {vendor_id:"Park Barrett",brand:"Park Barrett"},
  {vendor_id:"Parni",brand:"Little Parni"},
  {vendor_id:"Patachou",brand:"Patachou"},
  {vendor_id:"Pearson & Pearson",brand:"Pearson & Pearson"},
  {vendor_id:"Peek-A-Boo",brand:"Peek-A-Boo"},
  {vendor_id:"Peluche",brand:"Peluche"},
  {vendor_id:"Pequeno Tocon",brand:"Pequeno Tocon"},
  {vendor_id:"Perfect White Tee",brand:"Perfect White Tee"},
  {vendor_id:"Petidoux",brand:"Petidoux"},
  {vendor_id:"Petit Bouffon",brand:"Armando Martillo"},
  {vendor_id:"Petit Clair",brand:"Petit Clair"},
  {vendor_id:"Petit Indi",brand:"Petit Indi"},
  {vendor_id:"Petit Piao",brand:"Petit Piao"},
  {vendor_id:"Petit Tresor",brand:"Mantel"},
  {vendor_id:"Petite Amalie",brand:"Petite Amalie"},
  {vendor_id:"Petite Amalie",brand:"Petite Amalie Gold Label"},
  {vendor_id:"Petite Belle",brand:"Petite Belle"},
  {vendor_id:"Petite Blonde",brand:"Petite Blonde"},
  {vendor_id:"Petite Hailey",brand:"Petite Hailey"},
  {vendor_id:"Petite Hailey",brand:"Ph Play"},
  {vendor_id:"Petite Laure",brand:"Petite Laure"},
  {vendor_id:"Petite Plume",brand:"Petite Plume"},
  {vendor_id:"Phill And Phoebe",brand:"Phil And Phoebe"},
  {vendor_id:"Philosophy",brand:"Philosophy"},
  {vendor_id:"Pi & Pa",brand:"Pi & Pa"},
  {vendor_id:"Piccola Ludo",brand:"Piccolo Ludo"},
  {vendor_id:"Piccola Ludo",brand:"Piccola Ludo"},
  {vendor_id:"Piccola Speranza",brand:"Piccola Speranza"},
  {vendor_id:"Piccolo Bambino",brand:"Piccolo Bambino"},
  {vendor_id:"PicnTell",brand:"PicnTell"},
  {vendor_id:"Pink Chicken",brand:"Pink Chicken"},
  {vendor_id:"Pink Chicken",brand:"Coop Kids"},
  {vendor_id:"Pinzi",brand:"Pinzi"},
  {vendor_id:"Piupiuchick",brand:"Piupiuchick"},
  {vendor_id:"Popelin",brand:"Popelin"},
  {vendor_id:"Portaqui",brand:"Portaqui"},
  {vendor_id:"Posh Peanut",brand:"Posh Peanut"},
  {vendor_id:"Pouf",brand:"Pouf"},
  {vendor_id:"Preppy Goose",brand:"Preppy Goose"},
  {vendor_id:"Pretty Little Basics",brand:"Pretty Little Basics"},
  {vendor_id:"Prettypolly",brand:"Pretty Polly"},
  {vendor_id:"Project 6",brand:"Project 6"},
  {vendor_id:"Pryntd",brand:"Pryntd"},
  {vendor_id:"Pucci",brand:"Pucci"},
  {vendor_id:"Puma",brand:"Puma"},
  {vendor_id:"Pvh Legwear Llc",brand:"Calvin Klein"},
  {vendor_id:"Q-T Intimates",brand:"La Leche"},
  {vendor_id:"Q-T Intimates",brand:"Qt"},
  {vendor_id:"Question Everything",brand:"Question Everything"},
  {vendor_id:"Quincy Mae",brand:"Jamie Kay"},
  {vendor_id:"Quincy Mae",brand:"Quincy Mae"},
  {vendor_id:"Quincy Mae",brand:"Rylee+Cru"},
  {vendor_id:"Quincy Mae",brand:"Noralee"},
  {vendor_id:"Ra&Da Baby",brand:"Ra&Da Baby"},
  {vendor_id:"Rago",brand:"Rago"},
  {vendor_id:"Ralph Lauren",brand:"Ralph Lauren"},
  {vendor_id:"Raquette",brand:"Raquette"},
  {vendor_id:"Raspberryplum Limite",brand:"Raspberryplum Limited"},
  {vendor_id:"Regina",brand:"Regina"},
  {vendor_id:"Renfro",brand:"Ralph Lauren"},
  {vendor_id:"Repose Ams",brand:"Repose Ams"},
  {vendor_id:"Retrokid",brand:"Retrokid"},
  {vendor_id:"Revaz",brand:"Revaz"},
  {vendor_id:"Robo",brand:"Coccoli"},
  {vendor_id:"Rock Candy",brand:"Rock Candy"},
  {vendor_id:"Rock Your Baby",brand:"Rock Your Kid"},
  {vendor_id:"Rock Your Baby",brand:"Rock Your Baby"},
  {vendor_id:"Rosa Faia",brand:"Rosa Faia"},
  {vendor_id:"ROSE BRIEF MAKEUP",brand:"ROSE BRIEF MAKEUP"},
  {vendor_id:"Ruby",brand:"Ruby"},
  {vendor_id:"Rya Collection",brand:"Rya"},
  {vendor_id:"Rylee+Cru",brand:"Rylee+Cru"},
  {vendor_id:"Rylee+Cru",brand:"Quincy Mae"},
  {vendor_id:"S & B",brand:"S & B"},
  {vendor_id:"S & G",brand:"S & G"},
  {vendor_id:"Safe Harbor",brand:"Safe Harbor"},
  {vendor_id:"Sam Tbeile",brand:"Wonderline"},
  {vendor_id:"Sanremo",brand:"Sanremo"},
  {vendor_id:"Santa Barbara",brand:"Santa Barbara"},
  {vendor_id:"Saranomi",brand:"Saranoni"},
  {vendor_id:"Savewize",brand:"Savewize"},
  {vendor_id:"ScentFinity",brand:"Scentfinity"},
  {vendor_id:"Scotch & Soda",brand:"Scotch & Soda"},
  {vendor_id:"Scotch Bonnet",brand:"Scotch Bonnet"},
  {vendor_id:"Scotch Shrunk",brand:"Scotch & Soda"},
  {vendor_id:"Scraf Bar",brand:"Scarf Bar"},
  {vendor_id:"Sea To Shore",brand:"Waterwize"},
  {vendor_id:"Seattle Silver",brand:"Cashmere"},
  {vendor_id:"Sebastian. B",brand:"Sebastian. B"},
  {vendor_id:"Serlei",brand:"Champion"},
  {vendor_id:"Serlei",brand:"Serlei"},
  {vendor_id:"Sevim",brand:"Sevim"},
  {vendor_id:"Shaitel Grip",brand:"Shaitel Grip"},
  {vendor_id:"She Intimates",brand:"She"},
  {vendor_id:"Shoham Fashion Inc.",brand:"Goldstone"},
  {vendor_id:"Shoham Fashion Inc.",brand:"Blue Stone"},
  {vendor_id:"Showroom Fifty",brand:"Crew"},
  {vendor_id:"Showroom Fifty",brand:"Crew Kids"},
  {vendor_id:"Showroom Fifty",brand:"Crew Basics"},
  {vendor_id:"Showroom Fifty",brand:"Crew Mini"},
  {vendor_id:"Showroom Fifty",brand:"Cottier"},
  {vendor_id:"Showroom Fifty",brand:"Kipp"},
  {vendor_id:"Showroom Fifty",brand:"Klai"},
  {vendor_id:"Showroom Fifty",brand:"Crew Lounge"},
  {vendor_id:"Showroom Fifty",brand:"Crew Swim"},
  {vendor_id:"Showroom Fifty",brand:"Kipp Baby"},
  {vendor_id:"Showroom Lab",brand:"Jules & Juliette"},
  {vendor_id:"Siaomini",brand:"Siaomini"},
  {vendor_id:"Silly Billyz",brand:"Silly Billyz"},
  {vendor_id:"Silly Billyz",brand:"Null"},
  {vendor_id:"Simone Perele U.S.",brand:"Simone P."},
  {vendor_id:"Skinny Shirt",brand:"Skinny Shirt"},
  {vendor_id:"Skipp",brand:"Skipp"},
  {vendor_id:"SLEEK",brand:"SLEEK"},
  {vendor_id:"Sleek Sensations Ltd",brand:"Femtastic"},
  {vendor_id:"Sleek Sensations Ltd",brand:"S & B"},
  {vendor_id:"Sls Apparel",brand:"Sls Apparel"},
  {vendor_id:"SNOODS FOR LESS",brand:"ROYAL HEADWEAR"},
  {vendor_id:"Snug",brand:"Snug"},
  {vendor_id:"Snuggle Baby",brand:"Snuggle Baby"},
  {vendor_id:"So Loved",brand:"So Loved"},
  {vendor_id:"So Nikki",brand:"So Nikki"},
  {vendor_id:"So What",brand:"So What"},
  {vendor_id:"Social Grace & Compa",brand:"Social Grace & Company"},
  {vendor_id:"Sofia Rye",brand:"Sofia Rye"},
  {vendor_id:"Sol And Selene",brand:"Sol And Selene"},
  {vendor_id:"Sol Angeles",brand:"Sol Angeles"},
  {vendor_id:"Sonia Rykiel",brand:"Sonia Rykiel"},
  {vendor_id:"Space Grey",brand:"Space Grey"},
  {vendor_id:"Spanx",brand:"Spanx"},
  {vendor_id:"Spool Fine Knits",brand:"Spool Fine Knits"},
  {vendor_id:"Sproet & Sprout",brand:"Sproet & Sprout"},
  {vendor_id:"Ss23",brand:"Emi Jay"},
  {vendor_id:"Ss23",brand:"Petite"},
  {vendor_id:"Ss23",brand:"Posh Peanut"},
  {vendor_id:"Ss23",brand:"Nicsessories"},
  {vendor_id:"Ss23",brand:"The Gilded Bird"},
  {vendor_id:"St Shoppe",brand:"St"},
  {vendor_id:"State",brand:"State Bags"},
  {vendor_id:"State",brand:"State"},
  {vendor_id:"State Bags",brand:"State Bags"},
  {vendor_id:"Stella Cove",brand:"Stella Cove"},
  {vendor_id:"Steph",brand:"Steph"},
  {vendor_id:"Stickerbeans",brand:"Stickerbeans"},
  {vendor_id:"Sub_Urban Riot",brand:"Sub_ Urban Riot"},
  {vendor_id:"Submarine",brand:"Submarine"},
  {vendor_id:"Submarine",brand:"Oh Baby!"},
  {vendor_id:"Sun Child",brand:"Sun Child"},
  {vendor_id:"Super Smalls",brand:"Super Smalls"},
  {vendor_id:"Surelle",brand:"Surelle"},
  {vendor_id:"Sweet",brand:"Sweet"},
  {vendor_id:"Sweet Bamboo",brand:"Sweet Bamboo"},
  {vendor_id:"T",brand:"Tis Me"},
  {vendor_id:"T Bar",brand:"The Scarf Bar"},
  {vendor_id:"T.O Collection",brand:"Tomi"},
  {vendor_id:"T2 Love",brand:"T2 Love"},
  {vendor_id:"Tal",brand:"Tal"},
  {vendor_id:"Tal",brand:"Dacee"},
  {vendor_id:"Tal Ny",brand:"Tal"},
  {vendor_id:"Tal Ny",brand:"Dacee"},
  {vendor_id:"Tal Ny",brand:"Jrp"},
  {vendor_id:"Tal Ny",brand:"Tal Ny"},
  {vendor_id:"Tangerine",brand:"Tangerine"},
  {vendor_id:"Tartine Et Chocolat",brand:"Tartine Et Chocolat"},
  {vendor_id:"Teddy & Minou",brand:"Teddy & Minou"},
  {vendor_id:"Teela",brand:"Teela"},
  {vendor_id:"Teela",brand:"EMM"},
  {vendor_id:"Terez",brand:"Terez"},
  {vendor_id:"The Animalsobservato",brand:"The Animals Observatory"},
  {vendor_id:"The Baby Niche",brand:"The Baby Niche"},
  {vendor_id:"The Campamento",brand:"The Campamento"},
  {vendor_id:"The Campamento",brand:"Piupiuchick"},
  {vendor_id:"The Darling Effect",brand:"The Darling Effect"},
  {vendor_id:"The Gilded Bird",brand:"The Gilded Bird"},
  {vendor_id:"The Loki Shop",brand:"The Loki Shop"},
  {vendor_id:"The Mad Hatter",brand:"The Mad Hatter"},
  {vendor_id:"The Marc Jacobs",brand:"The Marc Jacobs"},
  {vendor_id:"The Middle Daughter",brand:"The Middle Daughter"},
  {vendor_id:"The New Society",brand:"The New Society"},
  {vendor_id:"The Scarf Bar",brand:"The Scarf Bar"},
  {vendor_id:"The Scarf Bar",brand:"Best Beanies"},
  {vendor_id:"The Slim Skirt",brand:"The Slim Skirt"},
  {vendor_id:"The Sunday Collectiv",brand:"The Sunday Collective"},
  {vendor_id:"The Tichel Shop",brand:"The Tichel Shop"},
  {vendor_id:"Three Bows",brand:"Bows Arts"},
  {vendor_id:"Three Bows",brand:"Three Bows"},
  {vendor_id:"Three Hearts",brand:"Three Hearts"},
  {vendor_id:"Three Hearts",brand:"Three Bows"},
  {vendor_id:"Tia Cibani",brand:"Tia Cibani"},
  {vendor_id:"Tichels By Sara",brand:"Tichels By Sara"},
  {vendor_id:"TIE UR KNOT",brand:"Tie Ur Knot"},
  {vendor_id:"Tinuk",brand:"Tinuk"},
  {vendor_id:"Tiny Cuddlez",brand:"Tiny Cuddlez"},
  {vendor_id:"Tiny Soul",brand:"Tiny Soul"},
  {vendor_id:"Tiny Treasures",brand:"Tiny Treasures"},
  {vendor_id:"Tinycottons",brand:"Tinycottons"},
  {vendor_id:"Tiptoe",brand:"Tiptoe"},
  {vendor_id:"Tiptoe",brand:"Wauw Capow"},
  {vendor_id:"Tiptoe Boutique",brand:"Tiptoe"},
  {vendor_id:"Tis Me",brand:"Tis Me"},
  {vendor_id:"Tji",brand:"Tji"},
  {vendor_id:"Tocoto Vintage",brand:"Tocoto Vintage"},
  {vendor_id:"Top Trendz",brand:"Top Trendz"},
  {vendor_id:"Totes",brand:"Totes"},
  {vendor_id:"Tricot Bebe",brand:"Tricot Bebe"},
  {vendor_id:"Trimfit",brand:"Trimfit"},
  {vendor_id:"Trussardi",brand:"Trussardi"},
  {vendor_id:"Tumble N Dry",brand:"Tumble N Dry"},
  {vendor_id:"Tuntun",brand:"Tuntun"},
  {vendor_id:"Tustello",brand:"Tustello"},
  {vendor_id:"Tutu Du Monde",brand:"Tutu Du Monde"},
  {vendor_id:"Tuxema Trends",brand:"Ewers"},
  {vendor_id:"Twee",brand:"Twee"},
  {vendor_id:"Tweenstyle",brand:"Tweenstyle"},
  {vendor_id:"Tweenstyle",brand:"Sparkle"},
  {vendor_id:"Twin & Chic",brand:"Twin & Chic"},
  {vendor_id:"Twin Boats",brand:"Twin Boats"},
  {vendor_id:"Twin Stars",brand:"Twin Stars"},
  {vendor_id:"Twinset",brand:"Twinset"},
  {vendor_id:"Two In A Castle",brand:"Two In A Castle"},
  {vendor_id:"Undercover Waterwear",brand:"Undercover Waterwear"},
  {vendor_id:"Undercover Waterwear",brand:"Memoi"},
  {vendor_id:"Unlabel",brand:"Unlabel"},
  {vendor_id:"Uppper Bags Inc",brand:"Upper Bags"},
  {vendor_id:"Urban Edge",brand:"Urban Edge"},
  {vendor_id:"Urban Expressions",brand:"Urban Expressions"},
  {vendor_id:"Urbani",brand:"Urbani"},
  {vendor_id:"Va Bien Internationa",brand:"Va Bien"},
  {vendor_id:"Valeri Chicago",brand:"Valeri Chicago"},
  {vendor_id:"Valeri`S Boutique",brand:"Valeri`S Boutique"},
  {vendor_id:"Vanilla S.C K. I M.",brand:"Vanilla"},
  {vendor_id:"Vanilla S.C K. I M.",brand:"Oh!Zuza"},
  {vendor_id:"Vanity Fair",brand:"Vanity Fair"},
  {vendor_id:"Venera Arapu",brand:"Venera Arapu"},
  {vendor_id:"Venus",brand:"Venus"},
  {vendor_id:"Ver de Terre",brand:"Ver de Terre"},
  {vendor_id:"Vibe",brand:"Vibe"},
  {vendor_id:"Vierra Rose",brand:"Vierra Rose"},
  {vendor_id:"Vilebrequin",brand:"Vilebrequin"},
  {vendor_id:"Vintage Havana",brand:"Vintage Havana"},
  {vendor_id:"Violet",brand:"Goody"},
  {vendor_id:"Visr",brand:"Bali"},
  {vendor_id:"Visr",brand:"Maidenform"},
  {vendor_id:"Visr",brand:"B. There"},
  {vendor_id:"Visr",brand:"Champion"},
  {vendor_id:"Wacoal America Inc",brand:"Wacoal"},
  {vendor_id:"Wacoal America Inc",brand:"B.Tempt`d"},
  {vendor_id:"Walk On Me",brand:"Walk On Me"},
  {vendor_id:"Wander & Wonder",brand:"Wander & Wonder"},
  {vendor_id:"Warners",brand:"Warners"},
  {vendor_id:"Watchtitude",brand:"Watchitude"},
  {vendor_id:"Waterwize",brand:"Waterwize"},
  {vendor_id:"We Are Kids",brand:"We Are Kids"},
  {vendor_id:"We Are The New Socie",brand:"The New Society"},
  {vendor_id:"Wee Monster",brand:"Wee Monster"},
  {vendor_id:"Weefarers",brand:"Weefarers"},
  {vendor_id:"Weekend House Kid",brand:"Weekend House Kid"},
  {vendor_id:"Wheat",brand:"Wheat"},
  {vendor_id:"Winx And Blinx",brand:"Winx And Blinx"},
  {vendor_id:"Wolford",brand:"Wolford"},
  {vendor_id:"Wonderline Inc.",brand:"Wonderline"},
  {vendor_id:"Wynken",brand:"Wynken"},
  {vendor_id:"Wynken",brand:"Piccola Ludo"},
  {vendor_id:"X Marks The Spot",brand:"X Marks The Spot"},
  {vendor_id:"Yaarn",brand:"Yaarn"},
  {vendor_id:"Yal",brand:"Yal"},
  {vendor_id:"Yell-Oh",brand:"Yell-Oh"},
  {vendor_id:"Your Name Pro",brand:"Your Name Pro"},
  {vendor_id:"Yporque",brand:"Yporque"},
  {vendor_id:"Zadig & Voltaire",brand:"Zadig & Voltaire"},
  {vendor_id:"Zeebra",brand:"Zeebra"},
  {vendor_id:"Zeelou Ny",brand:"Ruby"},
  {vendor_id:"Zeelou Ny",brand:"Zeelou Ny"},
  {vendor_id:"Zeelou Ny",brand:"Cindy And Bella"},
  {vendor_id:"Zeelou Ny",brand:"Bondoux"},
  {vendor_id:"Zeelou Ny",brand:"Top Trendz"},
  {vendor_id:"Zehu",brand:"Zehu"},
  {vendor_id:"Zenzii",brand:"Zenzii"},
  {vendor_id:"Zhoe & Tobiah",brand:"Zhoe & Tobiah"},
  {vendor_id:"Zina Kao Exclusives",brand:"Zina Kao Exclusives"},
  {vendor_id:"Zubii",brand:"Zubii"},
  {vendor_id:"Copenhagen Colors",brand:"Copenhagen Colors"},
  {vendor_id:"",brand:"Twinset"},
  {vendor_id:"",brand:"Piupiuchick"},
  {vendor_id:"",brand:"MiniMoi"},
  {vendor_id:"",brand:"Bamboo"},
  {vendor_id:"",brand:"Analogie"},
  {vendor_id:"",brand:"Compania Fantastica"},
  {vendor_id:"",brand:"Bene Bene"},
  {vendor_id:"",brand:"Lizi"},
  {vendor_id:"",brand:"Coco Blanc"},
  {vendor_id:"",brand:"Heirlooms"},
  {vendor_id:"",brand:"Air Bandana"},
  {vendor_id:"",brand:"Oilily"},
  {vendor_id:"",brand:"Bebe Organic"},
  {vendor_id:"",brand:"The New Society"},
  {vendor_id:"",brand:"Loud"},
  {vendor_id:"",brand:"Popelin"},
  {vendor_id:"",brand:"Hp Hair Accessories"},
  {vendor_id:"",brand:"Crew Lounge"},
  {vendor_id:"",brand:"Little Mish"},
  {vendor_id:"",brand:"Marmar"},
  {vendor_id:"",brand:"Aurora"},
  {vendor_id:"",brand:"Sproet & Sprout"},
  {vendor_id:"",brand:"Louis Louise"},
  {vendor_id:"",brand:"Phil and Phoebe"},
  {vendor_id:"",brand:"Sweet Threads"},
  {vendor_id:"",brand:"Ely`s & Co"},
  {vendor_id:"",brand:"Bonjoy"},
  {vendor_id:"",brand:"Paade Mode"},
  {vendor_id:"",brand:"Christina Rohde"},
  {vendor_id:"",brand:"Coccoli"},
  {vendor_id:"",brand:"Collection"},
  {vendor_id:"",brand:"Memoi"},
  {vendor_id:"",brand:"Oh Baby!"},
  {vendor_id:"",brand:"Zubii"},
  {vendor_id:"",brand:"Harper James"},
  {vendor_id:"",brand:"Tustello"},
  {vendor_id:"",brand:"Knot"},
  {vendor_id:"",brand:"Minimal"},
  {vendor_id:"",brand:"Nicsessories"},
  {vendor_id:"",brand:"Tuntun"},
  {vendor_id:"",brand:"Mipounet"},
  {vendor_id:"",brand:"Buho"},
  {vendor_id:"",brand:"Cherie Accessories"},
  {vendor_id:"",brand:"Latte"},
  {vendor_id:"",brand:"Emile Et Ida"},
  {vendor_id:"",brand:"Copenhagen Colors"},
  {vendor_id:"",brand:"Birinit"},
  {vendor_id:"",brand:"Tal"},
  {vendor_id:"",brand:"Huxbaby"},
  {vendor_id:"",brand:"Pink Chicken"},
  {vendor_id:"",brand:"Cozmo"},
  {vendor_id:"",brand:"Karl Lagerfeld"},
  {vendor_id:"",brand:"Patachou"},
  {vendor_id:"",brand:"Esme"},
  {vendor_id:"",brand:"Halo Luxe"},
  {vendor_id:"",brand:"Indee"},
  {vendor_id:"",brand:"Li & Me"},
  {vendor_id:"",brand:"Wander & Wonder"},
  {vendor_id:"",brand:"LUX Regular"},
  {vendor_id:"",brand:"Little Parni"},
  {vendor_id:"",brand:"Wheat"},
  {vendor_id:"",brand:"Le Bourdon"},
  {vendor_id:"",brand:"Favorite People"},
  {vendor_id:"",brand:"Valentina"},
  {vendor_id:"",brand:"Nino"},
  {vendor_id:"",brand:"Philosophy"},
  {vendor_id:"",brand:"Petit Blush"},
  {vendor_id:"",brand:"Lilou"},
  {vendor_id:"",brand:"Poppeto"},
  {vendor_id:"",brand:"Lilette"},
  {vendor_id:"",brand:"State Bags"},
  {vendor_id:"",brand:"Morley"},
  {vendor_id:"",brand:"Konges Slojd"},
  {vendor_id:"",brand:"Rylee+Cru"},
  {vendor_id:"",brand:"Fub"},
  {vendor_id:"",brand:"Colmar"},
  {vendor_id:"",brand:"C`Era Una Volta"},
  {vendor_id:"",brand:"Louise Misha"},
  {vendor_id:"",brand:"Motu Boys"},
  {vendor_id:"",brand:"JRP"},
  {vendor_id:"",brand:"Calla Lili"},
  {vendor_id:"",brand:"Petite Amalie"},
  {vendor_id:"",brand:"Angel Dear"},
  {vendor_id:"",brand:"Early Sunday"},
  {vendor_id:"",brand:"Tie Ur Knot"},
  {vendor_id:"",brand:"Kipp Baby"},
  {vendor_id:"",brand:"Bandeau"},
  {vendor_id:"",brand:"Seal"},
  {vendor_id:"",brand:"Lrdm"},
  {vendor_id:"",brand:"Tumble N Dry"},
  {vendor_id:"",brand:"Vibe"},
  {vendor_id:"",brand:"Bobo Choses"},
  {vendor_id:"",brand:"Revaz"},
  {vendor_id:"",brand:"Bopop"},
  {vendor_id:"",brand:"One Child"},
  {vendor_id:"",brand:"Hello Yellow"},
  {vendor_id:"",brand:"Tartine Et Chocolat"},
  {vendor_id:"",brand:"Coop Kids"},
  {vendor_id:"",brand:"Bari Lynn"},
  {vendor_id:"",brand:"Coton Pompom"},
  {vendor_id:"",brand:"The Campamento"},
  {vendor_id:"",brand:"Lil Legs"},
  {vendor_id:"",brand:"The Scarf Bar"},
  {vendor_id:"",brand:"Light+Nine"},
  {vendor_id:"",brand:"Whipped Cocoa"},
  {vendor_id:"",brand:"Looms"},
  {vendor_id:"",brand:"N+A"},
  {vendor_id:"",brand:"Dacee"},
  {vendor_id:"",brand:"Bee And Dee"},
  {vendor_id:"",brand:"Crew Essentials"},
  {vendor_id:"",brand:"Max & Co"},
  {vendor_id:"",brand:"FYI (Canvas)"},
  {vendor_id:"",brand:"Kipp"},
  {vendor_id:"",brand:"Froo"},
  {vendor_id:"",brand:"Fragile"},
  {vendor_id:"",brand:"Steph The Label"},
  {vendor_id:"",brand:"Prairie"},
  {vendor_id:"",brand:"Daisy Gift Box"},
  {vendor_id:"",brand:"Flowers By Zoe"},
  {vendor_id:"",brand:"Bace"},
  {vendor_id:"",brand:"Bondoux"},
  {vendor_id:"",brand:"Klai"},
  {vendor_id:"",brand:"Bebe Jolee"},
  {vendor_id:"",brand:"Heven"},
  {vendor_id:"",brand:"Pouf"},
  {vendor_id:"",brand:"Billieblush"},
  {vendor_id:"",brand:"Bonton"},
  {vendor_id:"",brand:"Olivia Rohde"},
  {vendor_id:"",brand:"Scotch & Soda"},
  {vendor_id:"",brand:"Ella and Rapha"},
  {vendor_id:"",brand:"Quincy Mae"},
  {vendor_id:"",brand:"Mallory And Merlot"},
  {vendor_id:"",brand:"N\u00b021"},
  {vendor_id:"",brand:"The Middle"},
  {vendor_id:"",brand:"Lux Baby"},
  {vendor_id:"",brand:"Crew Mini"},
  {vendor_id:"",brand:"Halo"},
  {vendor_id:"",brand:"Jolie Capri"},
  {vendor_id:"",brand:"Babyo"},
  {vendor_id:"",brand:"J`taime +1"},
  {vendor_id:"",brand:"Papillon"},
  {vendor_id:"",brand:"Lola"},
  {vendor_id:"",brand:"Circle"},
  {vendor_id:"",brand:"Creative Genius"},
  {vendor_id:"",brand:"Lydababy"},
  {vendor_id:"",brand:"Crew Kids"},
  {vendor_id:"",brand:"Petite Persona"},
  {vendor_id:"Luibelle",brand:"Bamboo"},
  {vendor_id:"Paade Mode",brand:"Paade Mode"},
  {vendor_id:"Luibelle",brand:"Le Bourdon"},
  {vendor_id:"Favorite People",brand:"Favorite People"},
  {vendor_id:"Luibelle",brand:"Valentina"},
  {vendor_id:"Petit Blush",brand:"Petit Blush"},
  {vendor_id:"Calla Lili",brand:"Calla Lili"},
  {vendor_id:"Angel Dear",brand:"Angel Dear"},
  {vendor_id:"Lydababy",brand:"Coton Pompom"},
  {vendor_id:"Junee",brand:"N+A"},
  {vendor_id:"Showroom Fifty",brand:"Crew Essentials"},
  {vendor_id:"Kikio",brand:"FYI (Canvas)"},
  {vendor_id:"Steph The Label",brand:"Steph The Label"},
  {vendor_id:"Luibelle",brand:"Bace"},
  {vendor_id:"Luibelle",brand:"Bebe Jolee"},
  {vendor_id:"Junee",brand:"The Middle"},
  {vendor_id:"Kikio",brand:"J`taime +1"},
  {vendor_id:"Circle",brand:"Circle"},
  {vendor_id:"Junee",brand:"Creative Genius"},
  {vendor_id:"Junee",brand:"Petite Persona"},
]

const purple = '#7c3aed'
const purpleD = '#6d28d9'
const purpleLight = '#f3f0ff'
const border = '#d4c8f0'

const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#6d28d9', whiteSpace: 'nowrap' }
const cellInput: React.CSSProperties = { background: 'transparent', border: 'none', outline: 'none', fontSize: 12, color: '#111', fontFamily: 'Inter, sans-serif', width: '100%', padding: 0 }
const inlineInput: React.CSSProperties = { background: '#fff', border: '1px solid #d1d5db', borderRadius: 5, padding: '3px 7px', fontSize: 12, color: '#111', outline: 'none', fontFamily: 'Inter, sans-serif' }

export default function SettingsPage() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [users, setUsers] = useState<DBUser[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [toastType, setToastType] = useState<'ok' | 'err'>('ok')
  const [tab, setTab] = useState<'users' | 'vendors' | 'stores'>('users')
  const [goingHome, setGoingHome] = useState(false)
  const [dirty, setDirty] = useState<Record<string, string[]>>({})

  // User tab
  const [newId, setNewId] = useState('')
  const [newStore, setNewStore] = useState('')
  const [newLocation, setNewLocation] = useState('')
  const [adding, setAdding] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)
  const [editUser, setEditUser] = useState<DBUser | null>(null)
  const [userSearch, setUserSearch] = useState('')

  // Stores tab
  const [stores, setStores] = useState<string[]>(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('qd_stores') : null
      return saved ? JSON.parse(saved) : DEFAULT_STORES
    } catch { return DEFAULT_STORES }
  })
  const [newStoreId, setNewStoreId] = useState('')

  // Vendor tab
  const [vendors, setVendors] = useState<VendorRow[]>(VENDOR_DATA_ORIG)
  const [vendorSearch, setVendorSearch] = useState('')
  const [vCtxMenu, setVCtxMenu] = useState<VCtxMenu | null>(null)
  const [editVendor, setEditVendor] = useState<{ idx: number; vendor_id: string; brand: string } | null>(null)
  const [newVendorId, setNewVendorId] = useState('')
  const [newBrand, setNewBrand] = useState('')

  const ctxRef = useRef<HTMLDivElement>(null)

  function saveStores(next: string[]) {
    setStores(next)
    try { localStorage.setItem('qd_stores', JSON.stringify(next)) } catch {}
  }

  function addStore(e: React.FormEvent) {
    e.preventDefault()
    const s = newStoreId.trim().toUpperCase()
    if (!s) return
    if (stores.includes(s)) { showToast(`❌ "${s}" already exists`, 'err'); return }
    saveStores([...stores, s])
    setNewStoreId('')
    showToast(`✅ Store "${s}" added`)
  }

  function removeStore(s: string) {
    if (s === 'ALL') { showToast('❌ Cannot remove ALL', 'err'); return }
    saveStores(stores.filter(x => x !== s))
    showToast(`🗑 Store "${s}" removed`)
  }

  useEffect(() => {
    const u = getSession()
    if (!u) { router.push('/'); return }
    setCurrentUser(u)
    fetchUsers()
  }, [router])

  // ── return to selector after screen lock / idle ───────────────────────────
  useEffect(() => {
    let hiddenAt: number | null = null
    const IDLE_MS = 5 * 60 * 1000
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now() }
      else if (document.visibilityState === 'visible') {
        if (hiddenAt !== null && Date.now() - hiddenAt >= IDLE_MS) router.push('/selector')
        hiddenAt = null
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [router])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ctxRef.current && !ctxRef.current.contains(e.target as Node)) {
        setCtxMenu(null); setVCtxMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function showToast(msg: string, type: 'ok' | 'err' = 'ok') {
    setToast(msg); setToastType(type)
    setTimeout(() => setToast(''), 3000)
  }

  async function fetchUsers() {
    setLoading(true)
    const { data, error } = await supabase.from('users').select('*').order('userid')
    if (error) { showToast('❌ Could not load users', 'err'); setLoading(false); return }
    setUsers(data as DBUser[] || [])
    setDirty({})
    setLoading(false)
  }

  function getModules(u: DBUser) { return dirty[u.id] !== undefined ? dirty[u.id] : u.modules }

  function toggleModule(u: DBUser, modId: string) {
    const cur = getModules(u)
    setDirty(d => ({ ...d, [u.id]: cur.includes(modId) ? cur.filter(m => m !== modId) : [...cur, modId] }))
  }

  async function saveRow(u: DBUser) {
    const mods = getModules(u)
    const { error } = await supabase.from('users').update({ modules: mods }).eq('id', u.id)
    if (error) { showToast(`❌ ${error.message}`, 'err') }
    else {
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, modules: mods } : x))
      setDirty(d => { const n = { ...d }; delete n[u.id]; return n })
    }
  }

  async function saveAllDirty() {
    for (const id of Object.keys(dirty)) {
      const u = users.find(x => x.id === id)
      if (u) await saveRow(u)
    }
  }

  async function goHome() {
    setGoingHome(true)
    await saveAllDirty()
    setGoingHome(false)
    router.push('/selector')
  }

  async function addUser(e: React.FormEvent) {
    e.preventDefault()
    const uid = newId.trim().toUpperCase()
    const store = newStore.trim().toUpperCase()
    if (!uid || !store) { showToast('❌ User ID and Store required', 'err'); return }
    setAdding(true)
    const { data: existing } = await supabase.from('users').select('id').eq('userid', uid).maybeSingle()
    if (existing) { showToast(`❌ "${uid}" already exists`, 'err'); setAdding(false); return }
    const { error } = await supabase.from('users').insert({ userid: uid, store, location: newLocation, modules: [] })
    if (error) { showToast(`❌ ${error.message}`, 'err'); setAdding(false); return }
    showToast('✅ User added')
    setNewId(''); setNewStore(''); setNewLocation('')
    setAdding(false)
    fetchUsers()
  }

  async function deleteUser(userId: string) {
    if (userId === currentUser?.userid) { showToast('❌ Cannot delete your own account', 'err'); return }
    const pw = prompt(`Enter password to delete "${userId}":`)
    if (pw === null) return
    if (pw.toLowerCase() !== DELETE_PASSWORD) { showToast('❌ Incorrect password', 'err'); return }
    const u = users.find(x => x.userid === userId)
    if (!u) return
    const { error } = await supabase.from('users').delete().eq('id', u.id)
    if (error) { showToast(`❌ ${error.message}`, 'err'); return }
    setUsers(prev => prev.filter(x => x.userid !== userId))
    showToast('🗑 Deleted')
  }

  async function saveEditUser() {
    if (!editUser) return
    const { error } = await supabase.from('users').update({
      userid: editUser.userid, store: editUser.store, location: editUser.location
    }).eq('id', editUser.id)
    if (error) { showToast(`❌ ${error.message}`, 'err'); return }
    setUsers(prev => prev.map(x => x.id === editUser.id ? { ...x, ...editUser } : x))
    setEditUser(null)
    showToast('✅ Saved')
  }

  // Vendor helpers
  const filteredVendors = useMemo(() => {
    const q = vendorSearch.toLowerCase().trim()
    if (!q) return vendors
    return vendors.filter(v => v.vendor_id.toLowerCase().includes(q) || v.brand.toLowerCase().includes(q))
  }, [vendors, vendorSearch])

  function addVendorRow(e: React.FormEvent) {
    e.preventDefault()
    const vid = newVendorId.trim()
    const br = newBrand.trim()
    if (!vid || !br) { showToast('❌ Both fields required', 'err'); return }
    setVendors(prev => [...prev, { vendor_id: vid, brand: br }])
    setNewVendorId(''); setNewBrand('')
    showToast('✅ Row added')
  }

  function saveEditVendor() {
    if (!editVendor) return
    setVendors(prev => prev.map((v, i) => i === editVendor.idx ? { vendor_id: editVendor.vendor_id, brand: editVendor.brand } : v))
    setEditVendor(null)
    showToast('✅ Saved')
  }

  function deleteVendorRow(idx: number) {
    // find actual index in full vendors array — filteredVendors[idx] matches by value
    const target = filteredVendors[idx]
    setVendors(prev => {
      const fullIdx = prev.findIndex(v => v === target)
      if (fullIdx === -1) return prev
      return prev.filter((_, i) => i !== fullIdx)
    })
    showToast('🗑 Removed')
  }

  const anyDirty = Object.keys(dirty).length > 0

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#eeeaf6', fontFamily: 'Inter, sans-serif', display: 'flex', flexDirection: 'column', fontSize: 12 }}>
      <style>{`
        * { box-sizing: border-box; }
        .ss-table { border-collapse: collapse; width: 100%; }
        .ss-table th { background: ${purpleLight}; color: ${purpleD}; font-size: 11px; font-weight: 700; padding: 5px 8px; border: 1px solid ${border}; text-align: left; white-space: nowrap; position: sticky; top: 0; z-index: 2; }
        .ss-table td { padding: 3px 8px; border: 1px solid #e8e0f8; font-size: 12px; color: #222; vertical-align: middle; height: 28px; }
        .ss-table tr:hover td { background: #f3f0ff !important; }
        .ss-table td.cell-check { text-align: center; width: 36px; padding: 2px 4px; }
        .ctx-menu { position: fixed; background: #fff; border: 1px solid ${border}; border-radius: 7px; box-shadow: 0 4px 18px rgba(124,58,237,0.18); z-index: 9999; min-width: 130px; overflow: hidden; }
        .ctx-item { padding: 8px 14px; font-size: 12px; font-weight: 600; cursor: pointer; color: #333; }
        .ctx-item:hover { background: ${purpleLight}; color: ${purpleD}; }
        .ctx-item.danger:hover { background: #fef2f2; color: #dc2626; }
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.35); z-index: 9998; display: flex; align-items: center; justify-content: center; }
        .modal { background: #fff; border-radius: 12px; padding: 24px; min-width: 300px; box-shadow: 0 8px 40px rgba(0,0,0,0.18); }
        .modal h3 { margin: 0 0 16px; font-size: 15px; color: ${purpleD}; }
        .modal label { font-size: 11px; font-weight: 700; color: #6d28d9; display: block; margin-bottom: 3px; }
        .modal input, .modal select { width: 100%; border: 1px solid #d1d5db; border-radius: 6px; padding: 6px 10px; font-size: 13px; margin-bottom: 12px; outline: none; }
        .modal-btns { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
        .btn-cancel { background: #f3f4f6; color: #374151; border: none; border-radius: 6px; padding: 6px 14px; font-size: 12px; font-weight: 700; cursor: pointer; }
        .btn-save { background: ${purple}; color: #fff; border: none; border-radius: 6px; padding: 6px 14px; font-size: 12px; font-weight: 700; cursor: pointer; }
        .settings-tabs { display: flex; border-bottom: 1px solid ${border}; background: rgba(255,255,255,0.5); padding: 0 16px; }
        .settings-tab { padding: 8px 18px; font-size: 13px; font-weight: 700; cursor: pointer; border: none; background: none; color: #9b8ec4; border-bottom: 3px solid transparent; }
        .settings-tab.active { color: ${purpleD}; border-bottom-color: ${purple}; }
        @media (max-width: 600px) { .settings-header-center { order: 3; width: 100%; } }
      `}</style>

      {/* ── HEADER ── */}
      <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${border}`, background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(8px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={goHome} disabled={goingHome}
            style={{ background: 'none', border: 'none', fontSize: 13, color: '#9b8ec4', cursor: 'pointer', fontWeight: 600 }}>
            {goingHome ? '💾 Saving…' : '← Home'}
          </button>
          <div style={{ width: 1, height: 16, background: border }} />
          <span style={{ fontSize: 12, color: '#9b8ec4' }}>
            <span style={{ fontWeight: 700, color: '#5b21b6' }}>{displayUser(currentUser?.userid)}</span>
          </span>
        </div>
        <div className="settings-header-center" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="18" height="21" viewBox="0 0 22 26" fill="none"><polygon points="11,1 21,7 21,19 11,25 1,19 1,7" fill="none" stroke="#7c3aed" strokeWidth="2"/></svg>
          <span style={{ fontSize: 15, fontWeight: 900, color: '#5b21b6', letterSpacing: '0.08em' }}>SETTINGS</span>
        </div>
        <div style={{ fontSize: 12, color: purple, fontWeight: 700, minWidth: 80, textAlign: 'right' }}>
          {anyDirty ? '● Unsaved' : ''}
        </div>
      </div>

      {/* ── TABS ── */}
      <div className="settings-tabs">
        <button className={`settings-tab ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>👤 User IDs</button>
        <button className={`settings-tab ${tab === 'vendors' ? 'active' : ''}`} onClick={() => setTab('vendors')}>🏷 Vendors / Brands</button>
        <button className={`settings-tab ${tab === 'stores' ? 'active' : ''}`} onClick={() => setTab('stores')}>🏪 Store IDs</button>
      </div>

      {/* ══ USER IDs TAB ══════════════════════════════════════════════════════ */}
      {tab === 'users' && (
        <>
          {/* Add row */}
          <form onSubmit={addUser} style={{ background: '#fff', borderBottom: `1px solid ${border}`, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <label style={labelStyle}>User ID:</label>
            <input value={newId} onChange={e => setNewId(e.target.value.toUpperCase())} maxLength={10}
              placeholder="e.g. SARA" style={{ ...inlineInput, width: 80, textTransform: 'uppercase', fontWeight: 700 }} />
            <label style={labelStyle}>Store:</label>
            <select value={newStore} onChange={e => setNewStore(e.target.value)} style={{ ...inlineInput, width: 88 }}>
              <option value="">—</option>
              {stores.map(s => <option key={s}>{s}</option>)}
            </select>
            <label style={labelStyle}>Location:</label>
            <select value={newLocation} onChange={e => setNewLocation(e.target.value)} style={{ ...inlineInput, width: 130 }}>
              <option value="">—</option>
              {LOCATIONS.map(l => <option key={l}>{l}</option>)}
            </select>
            <button type="submit" disabled={adding}
              style={{ background: purple, color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: adding ? 0.7 : 1 }}>
              {adding ? '…' : '+ Add'}
            </button>
          </form>

          {/* Spreadsheet */}
          {loading ? (
            <p style={{ color: '#9b8ec4', padding: 24 }}>Loading…</p>
          ) : (
            <div style={{ flex: 1, overflow: 'auto', padding: '0 0 60px' }}>
              {/* User search */}
              <div style={{ padding: '8px 16px 4px' }}>
                <input
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  placeholder="🔍 Search users…"
                  style={{ width: '100%', maxWidth: 280, background: '#f5f3ff', border: '1.5px solid #c4b5fd', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: '#3730a3', fontWeight: 600, outline: 'none', boxSizing: 'border-box' }}
                />
                {userSearch && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: '#9b8ec4' }}>
                    {users.filter(u => [u.userid, u.store, u.location].some(v => v?.toLowerCase().includes(userSearch.toLowerCase()))).length} result(s)
                  </span>
                )}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="ss-table">
                  <thead>
                    <tr>
                      <th style={{ width: 28, textAlign: 'center' }}>#</th>
                      <th style={{ width: 90 }}>User ID</th>
                      <th style={{ width: 80 }}>Store</th>
                      <th style={{ width: 130 }}>Location</th>
                      {ALL_MODULES.map(m => (
                        <th key={m.id} style={{ width: 66, textAlign: 'center', fontSize: 10 }}>{m.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 && (
                      <tr><td colSpan={ALL_MODULES.length + 4} style={{ textAlign: 'center', color: '#b8aed8', padding: 28 }}>No users yet.</td></tr>
                    )}
                    {users.filter(u => !userSearch || [u.userid, u.store, u.location].some(v => v?.toLowerCase().includes(userSearch.toLowerCase()))).map((u, i) => {
                      const mods = getModules(u)
                      const isDirty = dirty[u.id] !== undefined
                      return (
                        <tr key={u.id}
                          style={{ background: isDirty ? '#fdf4ff' : i % 2 === 0 ? '#fff' : '#faf8ff', cursor: 'default' }}
                          onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, kind: 'user', userId: u.userid }); setVCtxMenu(null) }}>
                          <td style={{ textAlign: 'center', color: '#aaa', fontSize: 10 }}>{i + 1}</td>
                          <td style={{ fontWeight: 800, color: '#3730a3', fontSize: 12, letterSpacing: '0.04em' }}>
                            {u.userid}{isDirty && <span style={{ color: purple, marginLeft: 4 }}>●</span>}
                          </td>
                          <td>
                            <select value={u.store} onChange={async e => {
                              const next = e.target.value
                              await supabase.from('users').update({ store: next }).eq('id', u.id)
                              setUsers(prev => prev.map(x => x.id === u.id ? { ...x, store: next } : x))
                            }} style={{ ...cellInput, cursor: 'pointer' }}>
                              {stores.map(s => <option key={s}>{s}</option>)}
                            </select>
                          </td>
                          <td>
                            <select value={u.location || ''} onChange={async e => {
                              const loc = e.target.value
                              await supabase.from('users').update({ location: loc }).eq('id', u.id)
                              setUsers(prev => prev.map(x => x.id === u.id ? { ...x, location: loc } : x))
                            }} style={{ ...cellInput, cursor: 'pointer' }}>
                              <option value="">—</option>
                              {LOCATIONS.map(l => <option key={l}>{l}</option>)}
                            </select>
                          </td>
                          {ALL_MODULES.map(m => (
                            <td key={m.id} className="cell-check">
                              <input type="checkbox" checked={mods.includes(m.id)} onChange={() => toggleModule(u, m.id)}
                                style={{ width: 13, height: 13, accentColor: purple, cursor: 'pointer' }} />
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {anyDirty && (
                <div style={{ padding: '8px 14px', background: '#fdf4ff', borderTop: `1px solid ${border}` }}>
                  <button onClick={saveAllDirty}
                    style={{ background: purple, color: '#fff', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    💾 Save Module Changes
                  </button>
                </div>
              )}
            </div>
          )}
          <div style={{ padding: '5px 14px', background: purpleLight, borderTop: `1px solid ${border}`, fontSize: 11, color: '#9b8ec4', position: 'sticky', bottom: 0 }}>
            {users.length} user{users.length !== 1 ? 's' : ''} · Right-click a row to edit or delete
          </div>
        </>
      )}

      {/* ══ VENDORS / BRANDS TAB ═════════════════════════════════════════════ */}
      {tab === 'vendors' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* Add row + search */}
          <div style={{ background: '#fff', borderBottom: `1px solid ${border}`, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label style={labelStyle}>Search:</label>
            <input value={vendorSearch} onChange={e => setVendorSearch(e.target.value)}
              placeholder="vendor or brand…" style={{ ...inlineInput, flex: 1, minWidth: 120 }} />
            <form onSubmit={addVendorRow} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={labelStyle}>Vendor:</label>
              <input value={newVendorId} onChange={e => setNewVendorId(e.target.value)}
                placeholder="Vendor name" style={{ ...inlineInput, width: 140 }} />
              <label style={labelStyle}>Brand:</label>
              <input value={newBrand} onChange={e => setNewBrand(e.target.value)}
                placeholder="Brand name" style={{ ...inlineInput, width: 140 }} />
              <button type="submit"
                style={{ background: purple, color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                + Add
              </button>
            </form>
          </div>

          {/* Spreadsheet */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 40px' }}>
            <div style={{ overflowX: 'auto', maxWidth: 700, margin: '0 auto', paddingTop: 8 }}>
              <table className="ss-table">
                <thead>
                  <tr>
                    <th style={{ width: 28, textAlign: 'center' }}>#</th>
                    <th>Vendor ID</th>
                    <th>Brand</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVendors.length === 0 && (
                    <tr><td colSpan={3} style={{ textAlign: 'center', color: '#9b8ec4', padding: 28 }}>No matches.</td></tr>
                  )}
                  {filteredVendors.map((v, i) => (
                    <tr key={i}
                      style={{ background: i % 2 === 0 ? '#fff' : '#faf8ff', cursor: 'default' }}
                      onContextMenu={e => { e.preventDefault(); setVCtxMenu({ x: e.clientX, y: e.clientY, kind: 'vendor', idx: i }); setCtxMenu(null) }}>
                      <td style={{ textAlign: 'center', color: '#aaa', fontSize: 10 }}>{i + 1}</td>
                      <td style={{ fontWeight: 700, color: purpleD }}>{v.vendor_id}</td>
                      <td style={{ color: '#374151' }}>{v.brand}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ padding: '5px 14px', background: purpleLight, borderTop: `1px solid ${border}`, fontSize: 11, color: '#9b8ec4', position: 'sticky', bottom: 0 }}>
            {filteredVendors.length} of {vendors.length} rows · Right-click a row to edit or delete
          </div>
        </div>
      )}

      {/* ══ STORE IDs TAB ════════════════════════════════════════════════════ */}
      {tab === 'stores' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* Add store */}
          <form onSubmit={addStore} style={{ background: '#fff', borderBottom: `1px solid ${border}`, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <label style={labelStyle}>New Store ID:</label>
            <input value={newStoreId} onChange={e => setNewStoreId(e.target.value.toUpperCase())} maxLength={10}
              placeholder="e.g. BK1" style={{ ...inlineInput, width: 90, textTransform: 'uppercase', fontWeight: 700 }} />
            <button type="submit"
              style={{ background: purple, color: '#fff', border: 'none', borderRadius: 6, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              + Add Store
            </button>
            <span style={{ fontSize: 11, color: '#9b8ec4', marginLeft: 8 }}>Store IDs are saved in your browser and used across User ID dropdowns.</span>
          </form>

          {/* Store list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px 60px' }}>
            <div style={{ maxWidth: 480 }}>
              {stores.map(s => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff', border: `1px solid ${border}`, borderRadius: 7, padding: '7px 12px', marginBottom: 6 }}>
                  <span style={{ fontWeight: 800, color: '#3730a3', fontSize: 13, letterSpacing: '0.06em' }}>{s}</span>
                  {s === 'ALL' ? (
                    <span style={{ fontSize: 11, color: '#b8aed8' }}>reserved</span>
                  ) : (
                    <button onClick={() => removeStore(s)}
                      style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 5, padding: '3px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: '5px 14px', background: purpleLight, borderTop: `1px solid ${border}`, fontSize: 11, color: '#9b8ec4', position: 'sticky', bottom: 0 }}>
            {stores.length} store{stores.length !== 1 ? 's' : ''} · Changes apply immediately to all dropdowns
          </div>
        </div>
      )}

      {/* ── CONTEXT MENU (Users) ── */}
      {ctxMenu && (
        <div ref={ctxRef} className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          <div className="ctx-item" onClick={() => {
            const u = users.find(x => x.userid === ctxMenu.userId)
            if (u) setEditUser({ ...u })
            setCtxMenu(null)
          }}>✏️ Edit</div>
          <div className="ctx-item danger" onClick={() => {
            deleteUser(ctxMenu.userId)
            setCtxMenu(null)
          }}>🗑 Delete</div>
        </div>
      )}

      {/* ── CONTEXT MENU (Vendors) ── */}
      {vCtxMenu && (
        <div ref={ctxRef} className="ctx-menu" style={{ left: vCtxMenu.x, top: vCtxMenu.y }}>
          <div className="ctx-item" onClick={() => {
            const v = filteredVendors[vCtxMenu.idx]
            setEditVendor({ idx: vCtxMenu.idx, vendor_id: v.vendor_id, brand: v.brand })
            setVCtxMenu(null)
          }}>✏️ Edit</div>
          <div className="ctx-item danger" onClick={() => {
            deleteVendorRow(vCtxMenu.idx)
            setVCtxMenu(null)
          }}>🗑 Delete</div>
        </div>
      )}

      {/* ── EDIT USER MODAL ── */}
      {editUser && (
        <div className="modal-overlay" onClick={() => setEditUser(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Edit User: {editUser.userid}</h3>
            <label>User ID</label>
            <input value={editUser.userid} onChange={e => setEditUser(u => u ? { ...u, userid: e.target.value.toUpperCase() } : u)} maxLength={10} />
            <label>Store</label>
            <select value={editUser.store} onChange={e => setEditUser(u => u ? { ...u, store: e.target.value } : u)}>
              {stores.map(s => <option key={s}>{s}</option>)}
            </select>
            <label>Location</label>
            <select value={editUser.location || ''} onChange={e => setEditUser(u => u ? { ...u, location: e.target.value } : u)}>
              <option value="">—</option>
              {LOCATIONS.map(l => <option key={l}>{l}</option>)}
            </select>
            <div className="modal-btns">
              <button className="btn-cancel" onClick={() => setEditUser(null)}>Cancel</button>
              <button className="btn-save" onClick={saveEditUser}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT VENDOR MODAL ── */}
      {editVendor && (
        <div className="modal-overlay" onClick={() => setEditVendor(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Edit Vendor Row</h3>
            <label>Vendor ID</label>
            <input value={editVendor.vendor_id} onChange={e => setEditVendor(v => v ? { ...v, vendor_id: e.target.value } : v)} />
            <label>Brand</label>
            <input value={editVendor.brand} onChange={e => setEditVendor(v => v ? { ...v, brand: e.target.value } : v)} />
            <div className="modal-btns">
              <button className="btn-cancel" onClick={() => setEditVendor(null)}>Cancel</button>
              <button className="btn-save" onClick={saveEditVendor}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ── TOAST ── */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: toastType === 'err' ? '#7f1d1d' : '#3b1f8c', color: '#fff', padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
