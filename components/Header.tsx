"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useState } from "react";

const links = [
  { href: "/", label: "New Order" },
  { href: "/orders", label: "Orders" },
  { href: "/services", label: "Services" },
  { href: "/providers", label: "API Providers" },
  { href: "/comments", label: "Comments" },
  { href: "/telegram", label: "Telegram" },
];

export default function Header() {
  const [open, setOpen] = useState(false);
  const [totalBalance, setTotalBalance] = useState("Checking...");
  const [selectedCurrency, setSelectedCurrency] = useState("USD");
  const [, setSelectedCurrencySymbol] = useState("$");
  const [availableCurrencies, setAvailableCurrencies] = useState([
    { code: "USD", symbol: "$", label: "US Dollar" },
  ]);

  const loadHeaderBalance = useCallback(async (currency = selectedCurrency) => {
    try {
      const res = await fetch(`/api/providers/balances?currency=${currency}`);
      const data = await res.json();

      if (!res.ok) {
        setTotalBalance("Balance error");
        return;
      }

      setSelectedCurrency(data.selectedCurrency ?? currency);
      setSelectedCurrencySymbol(data.selectedCurrencySymbol ?? "$");
      setAvailableCurrencies(
        data.availableCurrencies ?? [
          { code: "USD", symbol: "$", label: "US Dollar" },
        ]
      );

      const amount = Number(data.convertedTotal ?? 0);

      setTotalBalance(amount.toFixed(2));
    } catch {
      setTotalBalance("Balance error");
    }
  }, [selectedCurrency]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadHeaderBalance();
  }, [loadHeaderBalance]);

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link href="/" className="app-brand">
          <Image src="/logo.svg" alt="Panelist" width={32} height={32} className="app-logo" />
          <span>Panelist</span>
        </Link>

        <div className="app-balance-wrap" title="Total provider balance">
          <select
            className="app-balance-currency"
            value={selectedCurrency}
            onChange={(e) => {
              const nextCurrency = e.target.value;
              setSelectedCurrency(nextCurrency);
              loadHeaderBalance(nextCurrency);
            }}
          >
            {availableCurrencies.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.symbol}
              </option>
            ))}
          </select>

          <span className="app-balance-value">
            {selectedCurrency} {totalBalance}
          </span>
        </div>

        <nav className="app-nav">
          {links.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>

        <button
          type="button"
          className="app-menu-button"
          onClick={() => setOpen((value) => !value)}
          aria-label="Open menu"
        >
          ☰
        </button>
      </div>

      {open && (
        <nav className="app-mobile-nav">
          {links.map((link) => (
            <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}