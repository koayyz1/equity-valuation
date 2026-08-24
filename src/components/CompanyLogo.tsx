import { useEffect, useState } from 'react';

interface CompanyLogoProps {
  ticker: string;
  size?: number;
  className?: string;
}

/**
 * Render a company logo by ticker, pulled from Financial Modeling Prep's
 * public image CDN. If the image fails to load, fall back to a monogram
 * (first letter) on a neutral background.
 */
export function CompanyLogo({ ticker, size = 40, className = '' }: CompanyLogoProps) {
  const [failed, setFailed] = useState(false);

  // Reset failure state whenever the ticker changes.
  useEffect(() => {
    setFailed(false);
  }, [ticker]);

  // FMP uses hyphens in place of dots (e.g. BRK.B -> BRK-B).
  const safeTicker = ticker.toUpperCase().replace(/\./g, '-');
  const src = `https://financialmodelingprep.com/image-stock/${encodeURIComponent(safeTicker)}.png`;

  if (failed) {
    return (
      <div
        className={`shrink-0 rounded-md bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-300 font-bold ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.45 }}
      >
        {ticker.charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={`${ticker} logo`}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-md bg-white object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
