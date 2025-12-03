import { AnalysisResult, Place, CategoryType } from "../types";

export const downloadFile = (filename: string, content: string, contentType: string) => {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const escapeXml = (unsafe: string) => {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
};

export const generateKML = (result: AnalysisResult): string => {
  let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>MapSieve Export</name>
    <description>${escapeXml(result.summary)}</description>
`;

  // Define Styles for Categories
  const styles: Record<string, string> = {
    FOOD: 'ff0095ff',       // Orange (AABBGGRR in KML hex)
    DRINK: 'ffd65658',      // Indigo
    SIGHTSEEING: 'ff59c734',// Green
    SHOPPING: 'ff303bff',   // Red
    ACTIVITY: 'ffff7a00',   // Blue
    LODGING: 'fffac85a',    // Teal
    OTHER: 'ff938e8e'       // Gray
  };

  Object.keys(styles).forEach(cat => {
    kml += `
    <Style id="${cat}">
      <IconStyle>
        <color>${styles[cat]}</color>
        <scale>1.1</scale>
        <Icon>
          <href>http://maps.google.com/mapfiles/kml/pushpin/wht-pushpin.png</href>
        </Icon>
      </IconStyle>
    </Style>`;
  });

  result.places.forEach(place => {
    if (place.coordinates) {
      kml += `
    <Placemark>
      <name>${escapeXml(place.name)}</name>
      <description><![CDATA[
        <b>分類:</b> ${place.subCategory}<br/>
        <b>評分:</b> ${place.ratingPrediction}/5<br/>
        <b>說明:</b> ${place.description}<br/>
        <a href="${place.googleMapsUri || '#'}">Google Maps</a>
      ]]></description>
      <styleUrl>#${place.category}</styleUrl>
      <Point>
        <coordinates>${place.coordinates.lng},${place.coordinates.lat}</coordinates>
      </Point>
    </Placemark>`;
    }
  });

  kml += `
  </Document>
</kml>`;

  return kml;
};

export const generateCSV = (result: AnalysisResult): string => {
  // BOM for Excel to read UTF-8 correctly
  let csv = '\ufeff'; 
  csv += 'Name,Category,SubCategory,Location,Rating,Price,Tags,Description,Google Maps URL,Latitude,Longitude\n';

  const escapeCsv = (str: string) => {
    if (!str) return '';
    const safeStr = str.replace(/"/g, '""');
    return `"${safeStr}"`;
  };

  result.places.forEach(place => {
    const row = [
      escapeCsv(place.name),
      escapeCsv(place.category),
      escapeCsv(place.subCategory),
      escapeCsv(place.locationGuess),
      place.ratingPrediction,
      escapeCsv(place.priceLevel),
      escapeCsv(place.tags.join(', ')),
      escapeCsv(place.description),
      escapeCsv(place.googleMapsUri || ''),
      place.coordinates?.lat || '',
      place.coordinates?.lng || ''
    ];
    csv += row.join(',') + '\n';
  });

  return csv;
};
