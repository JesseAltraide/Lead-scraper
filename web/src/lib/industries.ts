/**
 * LinkedIn industry taxonomy, name -> numeric id.
 *
 * The company search actor filters by LinkedIn's own industry ids, not free
 * text (asking for "Software Engineering" as a string errors — it wants "4").
 * Source: https://github.com/HarvestAPI/linkedin-industry-codes-v2
 * (linkedin_industry_code_v2_all_eng_with_header.csv, 434 rows).
 *
 * Same shape as geography.ts: a fixed, known-good list checked in code before
 * any AI call, canonicalised so the form's free text becomes an id the actor
 * actually accepts.
 */

export type IndustryEntry = { id: string; label: string };

export const INDUSTRIES: IndustryEntry[] = [
  { id: "799", label: "Abrasives and Nonmetallic Minerals Manufacturing" },
  { id: "3246", label: "Accessible Architecture and Design" },
  { id: "3245", label: "Accessible Hardware Manufacturing" },
  { id: "2190", label: "Accommodation Services" },
  { id: "47", label: "Accounting" },
  { id: "73", label: "Administration of Justice" },
  { id: "1912", label: "Administrative and Support Services" },
  { id: "80", label: "Advertising Services" },
  { id: "709", label: "Agricultural Chemical Manufacturing" },
  { id: "901", label: "Agriculture, Construction, Mining Machinery Manufacturing" },
  { id: "2366", label: "Air, Water, and Waste Program Management" },
  { id: "94", label: "Airlines and Aviation" },
  { id: "120", label: "Alternative Dispute Resolution" },
  { id: "3253", label: "Alternative Fuel Vehicle Manufacturing" },
  { id: "125", label: "Alternative Medicine" },
  { id: "2077", label: "Ambulance Services" },
  { id: "2167", label: "Amusement Parks and Arcades" },
  { id: "481", label: "Animal Feed Manufacturing" },
  { id: "127", label: "Animation and Post-production" },
  { id: "598", label: "Apparel Manufacturing" },
  { id: "112", label: "Appliances, Electrical, and Electronics Manufacturing" },
  { id: "852", label: "Architectural and Structural Metal Manufacturing" },
  { id: "50", label: "Architecture and Planning" },
  { id: "71", label: "Armed Forces" },
  { id: "703", label: "Artificial Rubber and Synthetic Fiber Manufacturing" },
  { id: "38", label: "Artists and Writers" },
  { id: "973", label: "Audio and Video Equipment Manufacturing" },
  { id: "147", label: "Automation Machinery Manufacturing" },
  { id: "52", label: "Aviation and Aerospace Component Manufacturing" },
  { id: "529", label: "Baked Goods Manufacturing" },
  { id: "41", label: "Banking" },
  { id: "2217", label: "Bars, Taverns, and Nightclubs" },
  { id: "2197", label: "Bed-and-Breakfasts, Hostels, Homestays" },
  { id: "142", label: "Beverage Manufacturing" },
  { id: "390", label: "Biomass Electric Power Generation" },
  { id: "12", label: "Biotechnology Research" },
  { id: "3134", label: "Blockchain Services" },
  { id: "3125", label: "Blogs" },
  { id: "861", label: "Boilers, Tanks, and Shipping Container Manufacturing" },
  { id: "82", label: "Book and Periodical Publishing" },
  { id: "1602", label: "Book Publishing" },
  { id: "562", label: "Breweries" },
  { id: "36", label: "Broadcast Media Production and Distribution" },
  { id: "406", label: "Building Construction" },
  { id: "453", label: "Building Equipment Contractors" },
  { id: "460", label: "Building Finishing Contractors" },
  { id: "436", label: "Building Structure and Exterior Contractors" },
  { id: "11", label: "Business Consulting and Services" },
  { id: "3129", label: "Business Content" },
  { id: "3128", label: "Business Intelligence Platforms" },
  { id: "1641", label: "Cable and Satellite Programming" },
  { id: "129", label: "Capital Markets" },
  { id: "2212", label: "Caterers" },
  { id: "54", label: "Chemical Manufacturing" },
  { id: "690", label: "Chemical Raw Materials Manufacturing" },
  { id: "2128", label: "Child Day Care Services" },
  { id: "2048", label: "Chiropractors" },
  { id: "2139", label: "Circuses and Magic Shows" },
  { id: "90", label: "Civic and Social Organizations" },
  { id: "51", label: "Civil Engineering" },
  { id: "1738", label: "Claims Adjusting, Actuarial Services" },
  { id: "773", label: "Clay and Refractory Products Manufacturing" },
  { id: "3252", label: "Climate Data and Analytics" },
  { id: "3251", label: "Climate Technology Product Manufacturing" },
  { id: "341", label: "Coal Mining" },
  { id: "1938", label: "Collection Agencies" },
  { id: "1798", label: "Commercial and Industrial Equipment Rental" },
  { id: "2247", label: "Commercial and Industrial Machinery Maintenance" },
  { id: "918", label: "Commercial and Service Industry Machinery Manufacturing" },
  { id: "964", label: "Communications Equipment Manufacturing" },
  { id: "2374", label: "Community Development and Urban Planning" },
  { id: "2115", label: "Community Services" },
  { id: "118", label: "Computer and Network Security" },
  { id: "109", label: "Computer Games" },
  { id: "3", label: "Computer Hardware Manufacturing" },
  { id: "5", label: "Computer Networking Products" },
  { id: "24", label: "Computers and Electronics Manufacturing" },
  { id: "2368", label: "Conservation Programs" },
  { id: "48", label: "Construction" },
  { id: "871", label: "Construction Hardware Manufacturing" },
  { id: "1786", label: "Consumer Goods Rental" },
  { id: "91", label: "Consumer Services" },
  { id: "3068", label: "Correctional Institutions" },
  { id: "2019", label: "Cosmetology and Barber Schools" },
  { id: "3065", label: "Courts of Law" },
  { id: "1673", label: "Credit Intermediation" },
  { id: "849", label: "Cutlery and Handtool Manufacturing" },
  { id: "65", label: "Dairy Product Manufacturing" },
  { id: "2135", label: "Dance Companies" },
  { id: "2458", label: "Data Infrastructure and Analytics" },
  { id: "3130", label: "Data Security Software Products" },
  { id: "1", label: "Defense and Space Manufacturing" },
  { id: "2045", label: "Dentists" },
  { id: "99", label: "Design Services" },
  { id: "3101", label: "Desktop Computing Software Products" },
  { id: "3244", label: "Digital Accessibility Services" },
  { id: "564", label: "Distilleries" },
  { id: "132", label: "E-Learning Providers" },
  { id: "2375", label: "Economic Programs" },
  { id: "1999", label: "Education" },
  { id: "69", label: "Education Administration Programs" },
  { id: "998", label: "Electric Lighting Equipment Manufacturing" },
  { id: "383", label: "Electric Power Generation" },
  { id: "382", label: "Electric Power Transmission, Control, and Distribution" },
  { id: "2468", label: "Electrical Equipment Manufacturing" },
  { id: "2240", label: "Electronic and Precision Equipment Maintenance" },
  { id: "3099", label: "Embedded Software Products" },
  { id: "2122", label: "Emergency and Relief Services" },
  { id: "3242", label: "Engineering Services" },
  { id: "935", label: "Engines and Power Transmission Equipment Manufacturing" },
  { id: "28", label: "Entertainment Providers" },
  { id: "388", label: "Environmental Quality Programs" },
  { id: "86", label: "Environmental Services" },
  { id: "1779", label: "Equipment Rental Services" },
  { id: "110", label: "Events Services" },
  { id: "76", label: "Executive Offices" },
  { id: "1923", label: "Executive Search Services" },
  { id: "840", label: "Fabricated Metal Products" },
  { id: "122", label: "Facilities Services" },
  { id: "2060", label: "Family Planning Centers" },
  { id: "63", label: "Farming" },
  { id: "201", label: "Farming, Ranching, Forestry" },
  { id: "615", label: "Fashion Accessories Manufacturing" },
  { id: "43", label: "Financial Services" },
  { id: "2025", label: "Fine Arts Schools" },
  { id: "3070", label: "Fire Protection" },
  { id: "66", label: "Fisheries" },
  { id: "2020", label: "Flight Training" },
  { id: "23", label: "Food and Beverage Manufacturing" },
  { id: "1339", label: "Food and Beverage Retail" },
  { id: "34", label: "Food and Beverage Services" },
  { id: "2255", label: "Footwear and Leather Goods Repair" },
  { id: "622", label: "Footwear Manufacturing" },
  { id: "298", label: "Forestry and Logging" },
  { id: "385", label: "Fossil Fuel Electric Power Generation" },
  { id: "87", label: "Freight and Package Transportation" },
  { id: "504", label: "Fruit and Vegetable Preserves Manufacturing" },
  { id: "3255", label: "Fuel Cell Manufacturing" },
  { id: "101", label: "Fundraising" },
  { id: "1742", label: "Funds and Trusts" },
  { id: "26", label: "Furniture and Home Furnishings Manufacturing" },
  { id: "29", label: "Gambling Facilities and Casinos" },
  { id: "389", label: "Geothermal Electric Power Generation" },
  { id: "779", label: "Glass Product Manufacturing" },
  { id: "145", label: "Glass, Ceramics and Concrete Manufacturing" },
  { id: "2179", label: "Golf Courses and Country Clubs" },
  { id: "75", label: "Government Administration" },
  { id: "148", label: "Government Relations Services" },
  { id: "140", label: "Graphic Design" },
  { id: "1495", label: "Ground Passenger Transportation" },
  { id: "2353", label: "Health and Human Services" },
  { id: "68", label: "Higher Education" },
  { id: "431", label: "Highway, Street, and Bridge Construction" },
  { id: "2161", label: "Historical Sites" },
  { id: "1905", label: "Holding Companies" },
  { id: "2074", label: "Home Health Care Services" },
  { id: "150", label: "Horticulture" },
  { id: "31", label: "Hospitality" },
  { id: "2081", label: "Hospitals" },
  { id: "14", label: "Hospitals and Health Care" },
  { id: "2194", label: "Hotels and Motels" },
  { id: "1080", label: "Household and Institutional Furniture Manufacturing" },
  { id: "1005", label: "Household Appliance Manufacturing" },
  { id: "2318", label: "Household Services" },
  { id: "2369", label: "Housing and Community Development" },
  { id: "3081", label: "Housing Programs" },
  { id: "137", label: "Human Resources Services" },
  { id: "923", label: "HVAC and Refrigeration Equipment Manufacturing" },
  { id: "384", label: "Hydroelectric Power Generation" },
  { id: "88", label: "Individual and Family Services" },
  { id: "135", label: "Industrial Machinery Manufacturing" },
  { id: "1909", label: "Industry Associations" },
  { id: "84", label: "Information Services" },
  { id: "42", label: "Insurance" },
  { id: "1737", label: "Insurance Agencies and Brokerages" },
  { id: "1743", label: "Insurance and Employee Benefit Funds" },
  { id: "1725", label: "Insurance Carriers" },
  { id: "3126", label: "Interior Design" },
  { id: "74", label: "International Affairs" },
  { id: "141", label: "International Trade and Development" },
  { id: "1285", label: "Internet Marketplace Platforms" },
  { id: "3124", label: "Internet News" },
  { id: "3132", label: "Internet Publishing" },
  { id: "1504", label: "Interurban and Rural Bus Services" },
  { id: "1720", label: "Investment Advice" },
  { id: "45", label: "Investment Banking" },
  { id: "46", label: "Investment Management" },
  { id: "96", label: "IT Services and IT Consulting" },
  { id: "3102", label: "IT System Custom Software Development" },
  { id: "3106", label: "IT System Data Services" },
  { id: "1855", label: "IT System Design Services" },
  { id: "3104", label: "IT System Installation and Disposal" },
  { id: "3103", label: "IT System Operations and Maintenance" },
  { id: "3107", label: "IT System Testing and Evaluation" },
  { id: "3105", label: "IT System Training and Support" },
  { id: "1965", label: "Janitorial Services" },
  { id: "2934", label: "Landscaping Services" },
  { id: "2029", label: "Language Schools" },
  { id: "2272", label: "Laundry and Drycleaning Services" },
  { id: "77", label: "Law Enforcement" },
  { id: "9", label: "Law Practice" },
  { id: "128", label: "Leasing Non-residential Real Estate" },
  { id: "1759", label: "Leasing Residential Real Estate" },
  { id: "616", label: "Leather Product Manufacturing" },
  { id: "10", label: "Legal Services" },
  { id: "72", label: "Legislative Offices" },
  { id: "85", label: "Libraries" },
  { id: "794", label: "Lime and Gypsum Products Manufacturing" },
  { id: "1696", label: "Loan Brokers" },
  { id: "55", label: "Machinery Manufacturing" },
  { id: "994", label: "Magnetic and Optical Media Manufacturing" },
  { id: "25", label: "Manufacturing" },
  { id: "95", label: "Maritime Transportation" },
  { id: "97", label: "Market Research" },
  { id: "1862", label: "Marketing Services" },
  { id: "1095", label: "Mattress and Blinds Manufacturing" },
  { id: "983", label: "Measuring and Control Instrument Manufacturing" },
  { id: "521", label: "Meat Products Manufacturing" },
  { id: "3133", label: "Media & Telecommunications" },
  { id: "126", label: "Media Production" },
  { id: "2069", label: "Medical and Diagnostic Laboratories" },
  { id: "17", label: "Medical Equipment Manufacturing" },
  { id: "13", label: "Medical Practices" },
  { id: "139", label: "Mental Health Care" },
  { id: "345", label: "Metal Ore Mining" },
  { id: "883", label: "Metal Treatments" },
  { id: "887", label: "Metal Valve, Ball, and Roller Manufacturing" },
  { id: "928", label: "Metalworking Machinery Manufacturing" },
  { id: "2391", label: "Military and International Affairs" },
  { id: "56", label: "Mining" },
  { id: "3100", label: "Mobile Computing Software Products" },
  { id: "2214", label: "Mobile Food Services" },
  { id: "3131", label: "Mobile Gaming Apps" },
  { id: "53", label: "Motor Vehicle Manufacturing" },
  { id: "1042", label: "Motor Vehicle Parts Manufacturing" },
  { id: "1611", label: "Movies and Sound Recording" },
  { id: "35", label: "Movies, Videos and Sound" },
  { id: "2159", label: "Museums" },
  { id: "37", label: "Museums, Historical Sites, and Zoos" },
  { id: "115", label: "Musicians" },
  { id: "114", label: "Nanotechnology Research" },
  { id: "397", label: "Natural Gas Distribution" },
  { id: "3096", label: "Natural Gas Extraction" },
  { id: "81", label: "Newspaper Publishing" },
  { id: "100", label: "Non-profit Organizations" },
  { id: "356", label: "Nonmetallic Mineral Mining" },
  { id: "413", label: "Nonresidential Building Construction" },
  { id: "386", label: "Nuclear Electric Power Generation" },
  { id: "2091", label: "Nursing Homes and Residential Care Facilities" },
  { id: "1916", label: "Office Administration" },
  { id: "1090", label: "Office Furniture and Fixtures Manufacturing" },
  { id: "679", label: "Oil and Coal Product Manufacturing" },
  { id: "57", label: "Oil and Gas" },
  { id: "3095", label: "Oil Extraction" },
  { id: "332", label: "Oil, Gas, and Mining" },
  { id: "1445", label: "Online and Mail Order Retail" },
  { id: "113", label: "Online Audio and Video Media" },
  { id: "2401", label: "Operations Consulting" },
  { id: "2050", label: "Optometrists" },
  { id: "2063", label: "Outpatient Care Centers" },
  { id: "123", label: "Outsourcing and Offshoring Consulting" },
  { id: "146", label: "Packaging and Containers Manufacturing" },
  { id: "722", label: "Paint, Coating, and Adhesive Manufacturing" },
  { id: "61", label: "Paper and Forest Product Manufacturing" },
  { id: "1745", label: "Pension Funds" },
  { id: "39", label: "Performing Arts" },
  { id: "2130", label: "Performing Arts and Spectator Sports" },
  { id: "1600", label: "Periodical Publishing" },
  { id: "2258", label: "Personal and Laundry Services" },
  { id: "18", label: "Personal Care Product Manufacturing" },
  { id: "2259", label: "Personal Care Services" },
  { id: "2282", label: "Pet Services" },
  { id: "15", label: "Pharmaceutical Manufacturing" },
  { id: "131", label: "Philanthropic Fundraising Services" },
  { id: "136", label: "Photography" },
  { id: "2054", label: "Physical, Occupational and Speech Therapists" },
  { id: "2040", label: "Physicians" },
  { id: "1520", label: "Pipeline Transportation" },
  { id: "743", label: "Plastics and Rubber Product Manufacturing" },
  { id: "117", label: "Plastics Manufacturing" },
  { id: "107", label: "Political Organizations" },
  { id: "1573", label: "Postal Services" },
  { id: "67", label: "Primary and Secondary Education" },
  { id: "807", label: "Primary Metal Manufacturing" },
  { id: "83", label: "Printing Services" },
  { id: "1911", label: "Professional Organizations" },
  { id: "1810", label: "Professional Services" },
  { id: "105", label: "Professional Training and Coaching" },
  { id: "2360", label: "Public Assistance Programs" },
  { id: "2358", label: "Public Health" },
  { id: "79", label: "Public Policy Offices" },
  { id: "98", label: "Public Relations and Communications Services" },
  { id: "78", label: "Public Safety" },
  { id: "2143", label: "Racetracks" },
  { id: "1633", label: "Radio and Television Broadcasting" },
  { id: "1481", label: "Rail Transportation" },
  { id: "62", label: "Railroad Equipment Manufacturing" },
  { id: "64", label: "Ranching" },
  { id: "256", label: "Ranching and Fisheries" },
  { id: "44", label: "Real Estate" },
  { id: "1770", label: "Real Estate Agents and Brokers" },
  { id: "1757", label: "Real Estate and Equipment Rental Services" },
  { id: "40", label: "Recreational Facilities" },
  { id: "3256", label: "Regenerative Design" },
  { id: "89", label: "Religious Institutions" },
  { id: "3241", label: "Renewable Energy Equipment Manufacturing" },
  { id: "3240", label: "Renewable Energy Power Generation" },
  { id: "144", label: "Renewable Energy Semiconductor Manufacturing" },
  { id: "2225", label: "Repair and Maintenance" },
  { id: "70", label: "Research Services" },
  { id: "408", label: "Residential Building Construction" },
  { id: "32", label: "Restaurants" },
  { id: "27", label: "Retail" },
  { id: "19", label: "Retail Apparel and Fashion" },
  { id: "1319", label: "Retail Appliances, Electrical, and Electronic Equipment" },
  { id: "3186", label: "Retail Art Dealers" },
  { id: "111", label: "Retail Art Supplies" },
  { id: "1409", label: "Retail Books and Printed News" },
  { id: "1324", label: "Retail Building Materials and Garden Equipment" },
  { id: "1423", label: "Retail Florists" },
  { id: "1309", label: "Retail Furniture and Home Furnishings" },
  { id: "1370", label: "Retail Gasoline" },
  { id: "22", label: "Retail Groceries" },
  { id: "1359", label: "Retail Health and Personal Care Products" },
  { id: "143", label: "Retail Luxury Goods and Jewelry" },
  { id: "1292", label: "Retail Motor Vehicles" },
  { id: "1407", label: "Retail Musical Instruments" },
  { id: "138", label: "Retail Office Equipment" },
  { id: "1424", label: "Retail Office Supplies and Gifts" },
  { id: "3250", label: "Retail Pharmacies" },
  { id: "1431", label: "Retail Recyclable Materials & Used Merchandise" },
  { id: "2253", label: "Reupholstery and Furniture Repair" },
  { id: "3247", label: "Robot Manufacturing" },
  { id: "3248", label: "Robotics Engineering" },
  { id: "763", label: "Rubber Products Manufacturing" },
  { id: "1649", label: "Satellite Telecommunications" },
  { id: "1678", label: "Savings Institutions" },
  { id: "1512", label: "School and Employee Bus Services" },
  { id: "528", label: "Seafood Product Manufacturing" },
  { id: "2012", label: "Secretarial Schools" },
  { id: "1713", label: "Securities and Commodity Exchanges" },
  { id: "121", label: "Security and Investigations" },
  { id: "1956", label: "Security Guards and Patrol Services" },
  { id: "1958", label: "Security Systems Services" },
  { id: "7", label: "Semiconductor Manufacturing" },
  { id: "3243", label: "Services for Renewable Energy" },
  { id: "2112", label: "Services for the Elderly and Disabled" },
  { id: "1625", label: "Sheet Music Publishing" },
  { id: "58", label: "Shipbuilding" },
  { id: "1517", label: "Shuttles and Special Needs Transportation Services" },
  { id: "1532", label: "Sightseeing Transportation" },
  { id: "2181", label: "Skiing Facilities" },
  { id: "3254", label: "Smart Meter Manufacturing" },
  { id: "727", label: "Soap and Cleaning Product Manufacturing" },
  { id: "3127", label: "Social Networking Platforms" },
  { id: "4", label: "Software Development" },
  { id: "387", label: "Solar Electric Power Generation" },
  { id: "1623", label: "Sound Recording" },
  { id: "3089", label: "Space Research and Technology" },
  { id: "435", label: "Specialty Trade Contractors" },
  { id: "33", label: "Spectator Sports" },
  { id: "20", label: "Sporting Goods Manufacturing" },
  { id: "2027", label: "Sports and Recreation Instruction" },
  { id: "2142", label: "Sports Teams and Clubs" },
  { id: "873", label: "Spring and Wire Product Manufacturing" },
  { id: "104", label: "Staffing and Recruiting" },
  { id: "404", label: "Steam and Air-Conditioning Supply" },
  { id: "102", label: "Strategic Management Services" },
  { id: "428", label: "Subdivision of Land" },
  { id: "495", label: "Sugar and Confectionery Product Manufacturing" },
  { id: "3249", label: "Surveying and Mapping Services" },
  { id: "1505", label: "Taxi and Limousine Services" },
  { id: "2018", label: "Technical and Vocational Training" },
  { id: "6", label: "Technology, Information and Internet" },
  { id: "1594", label: "Technology, Information and Media" },
  { id: "8", label: "Telecommunications" },
  { id: "1644", label: "Telecommunications Carriers" },
  { id: "1931", label: "Telephone Call Centers" },
  { id: "1925", label: "Temporary Help Services" },
  { id: "60", label: "Textile Manufacturing" },
  { id: "2133", label: "Theater Companies" },
  { id: "130", label: "Think Tanks" },
  { id: "21", label: "Tobacco Manufacturing" },
  { id: "108", label: "Translation and Localization" },
  { id: "1029", label: "Transportation Equipment Manufacturing" },
  { id: "3085", label: "Transportation Programs" },
  { id: "116", label: "Transportation, Logistics, Supply Chain and Storage" },
  { id: "30", label: "Travel Arrangements" },
  { id: "92", label: "Truck Transportation" },
  { id: "1750", label: "Trusts and Estates" },
  { id: "876", label: "Turned Products and Fastener Manufacturing" },
  { id: "1497", label: "Urban Transit Services" },
  { id: "59", label: "Utilities" },
  { id: "3086", label: "Utilities Administration" },
  { id: "419", label: "Utility System Construction" },
  { id: "2226", label: "Vehicle Repair and Maintenance" },
  { id: "106", label: "Venture Capital and Private Equity Principals" },
  { id: "16", label: "Veterinary Services" },
  { id: "2125", label: "Vocational Rehabilitation Services" },
  { id: "93", label: "Warehousing and Storage" },
  { id: "1981", label: "Waste Collection" },
  { id: "1986", label: "Waste Treatment and Disposal" },
  { id: "400", label: "Water Supply and Irrigation Systems" },
  { id: "398", label: "Water, Waste, Steam, and Air Conditioning Services" },
  { id: "124", label: "Wellness and Fitness Services" },
  { id: "133", label: "Wholesale" },
  { id: "1267", label: "Wholesale Alcoholic Beverages" },
  { id: "1222", label: "Wholesale Apparel and Sewing Supplies" },
  { id: "1171", label: "Wholesale Appliances, Electrical, and Electronics" },
  { id: "49", label: "Wholesale Building Materials" },
  { id: "1257", label: "Wholesale Chemical and Allied Products" },
  { id: "1157", label: "Wholesale Computer Equipment" },
  { id: "1221", label: "Wholesale Drugs and Sundries" },
  { id: "1231", label: "Wholesale Food and Beverage" },
  { id: "1230", label: "Wholesale Footwear" },
  { id: "1137", label: "Wholesale Furniture and Home Furnishings" },
  { id: "1178", label: "Wholesale Hardware, Plumbing, Heating Equipment" },
  { id: "134", label: "Wholesale Import and Export" },
  { id: "1208", label: "Wholesale Luxury Goods and Jewelry" },
  { id: "1187", label: "Wholesale Machinery" },
  { id: "1166", label: "Wholesale Metals and Minerals" },
  { id: "1128", label: "Wholesale Motor Vehicles and Parts" },
  { id: "1212", label: "Wholesale Paper Products" },
  { id: "1262", label: "Wholesale Petroleum and Petroleum Products" },
  { id: "1153", label: "Wholesale Photography Equipment and Supplies" },
  { id: "1250", label: "Wholesale Raw Farm Products" },
  { id: "1206", label: "Wholesale Recyclable Materials" },
  { id: "2489", label: "Wind Electric Power Generation" },
  { id: "2500", label: "Wineries" },
  { id: "119", label: "Wireless Services" },
  { id: "625", label: "Women's Handbag Manufacturing" },
  { id: "784", label: "Wood Product Manufacturing" },
  { id: "103", label: "Writing and Editing" },
  { id: "2163", label: "Zoos and Botanical Gardens" },
];

export const KNOWN_INDUSTRIES: string[] = INDUSTRIES.map((i) => i.label);

const LOOKUP = new Map<string, IndustryEntry>();
for (const entry of INDUSTRIES) LOOKUP.set(entry.label.toLowerCase(), entry);

/**
 * Common shorthand that doesn't appear as its own row in LinkedIn's taxonomy.
 *
 * KNOWN LIMITATION: this list is hand-picked, not learned. The actor's
 * taxonomy is fixed (434 entries, no free text), so anything a user types
 * that isn't already covered here gets rejected outright, however reasonable
 * it sounds to them ("Schooling", "Consulting Firm", "Non-Profit"). Nothing
 * in the running app currently records which inputs actually get rejected,
 * so this list can only grow from guessing in advance, not from real usage.
 *
 * The fix, not yet built: log every rejected industry value (the raw input,
 * not who typed it) the same way tool_calls already logs every agent
 * action, and periodically review the most frequent misses to add as
 * aliases here. That turns "we hope we covered the common cases" into "we
 * know exactly what people typed and didn't match, ranked by frequency" —
 * the same shift `suggestIndustries` below makes for a single rejection,
 * applied over every rejection this form has ever produced.
 */
const ALIASES: Record<string, string> = {
  saas: "software development",
  "b2b saas": "software development",
  "software as a service": "software development",
  tech: "technology, information and internet",
  technology: "technology, information and internet",
  // Found during manual end-to-end testing (week5-progress.md Errors & Fixes
  // #14): the plain English term people actually type for this industry
  // wasn't aliased at all, only the SaaS-specific phrasings were.
  "software engineering": "software development",
  it: "it services and it consulting",
  fintech: "financial services",
  healthtech: "hospitals and health care",
  edtech: "e-learning providers",
  ecommerce: "retail",
  "e-commerce": "retail",
  // Found during this session's own testing of suggestIndustries: without
  // this, "Non-Profit" only got a suggestion instead of resolving outright,
  // despite being a near-exact match. Exactly the kind of miss the ALIASES
  // limitation note above describes — caught this time by hand, ideally by
  // monitored real input going forward.
  "non-profit": "non-profit organizations",
  nonprofit: "non-profit organizations",
  "non profit": "non-profit organizations",
};

/**
 * Returns the matching {id, label}, or null if nothing in LinkedIn's
 * taxonomy matches. Case and spacing are forgiven; an invented industry is
 * not — same shape as geography.ts's canonicalPlace.
 */
export function canonicalIndustry(input: string): IndustryEntry | null {
  const base = input.trim().toLowerCase().replace(/\s+/g, " ");
  const aliased = ALIASES[base] ?? base;
  return LOOKUP.get(aliased) ?? null;
}

export function isKnownIndustry(input: string): boolean {
  return canonicalIndustry(input) !== null;
}

/** Classic edit-distance DP. 434 short labels is cheap enough to run per rejection. */
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1]! + 1, // insertion
        prev[j]! + 1, // deletion
        prev[j - 1]! + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/** Strips a common suffix so "Schooling" can match labels containing "School". */
function stem(word: string): string {
  return word.replace(/(ing|ies|es|s)$/, "");
}

/**
 * When nothing matches, suggest real entries instead of leaving the user to
 * guess two hard-coded examples. Runs entirely in code, instantly, right
 * where the rejection happens — no AI call, and the user never has to leave
 * the intake form to get a useful answer.
 *
 * Two passes: a substring/stem match first (catches "Schooling" -> "School
 * and Employee Bus Services", "Secretarial Schools", "Fine Arts Schools" —
 * exactly the case this was built for), falling back to edit distance only
 * when nothing shares a real word, so garbled input still gets *something*
 * better than silence.
 */
export function suggestIndustries(input: string, max = 3): string[] {
  const base = input.trim().toLowerCase();
  if (!base) return [];

  const words = base.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  const scored: { label: string; score: number }[] = [];

  for (const label of KNOWN_INDUSTRIES) {
    const lower = label.toLowerCase();
    let score = 0;

    for (const w of words) {
      if (lower.includes(w)) score += w.length * 2; // a real word matched outright
      const s = stem(w);
      if (s.length >= 3 && s !== w && lower.includes(s)) score += s.length; // stemmed match
    }

    if (score === 0) {
      // Only worth surfacing if it's in the right ballpark — otherwise a
      // "closest" match from 434 options is just noise.
      const distance = levenshtein(base, lower);
      if (distance <= Math.max(4, Math.floor(lower.length * 0.4))) {
        score = 1 / (distance + 1);
      }
    }

    if (score > 0) scored.push({ label, score });
  }

  // Stable sort keeps the taxonomy's own (roughly alphabetical) order as the
  // tiebreak, so equally-good matches come back in a consistent order.
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((s) => s.label);
}
