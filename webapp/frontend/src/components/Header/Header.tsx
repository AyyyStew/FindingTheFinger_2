import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import styles from './Header.module.css'

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  return (
    <header className={styles.header}>
      <NavLink to="/" className={styles.title}>
        Finding the Finger
      </NavLink>
      <button
        type="button"
        className={styles.menuButton}
        aria-expanded={menuOpen}
        aria-controls="site-navigation"
        aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span className={styles.menuIcon} aria-hidden="true" />
      </button>
      <nav
        id="site-navigation"
        className={menuOpen ? `${styles.nav} ${styles.navOpen}` : styles.nav}
      >
        <NavLink to="/" className={({ isActive }) => isActive ? `${styles.link} ${styles.active}` : styles.link} end>
          Search
        </NavLink>
        <NavLink to="/map" className={({ isActive }) => isActive ? `${styles.link} ${styles.active}` : styles.link}>
          Map
        </NavLink>
        <NavLink to="/corpus" className={({ isActive }) => isActive ? `${styles.link} ${styles.active}` : styles.link}>
          Corpus
        </NavLink>
        <NavLink to="/about" className={({ isActive }) => isActive ? `${styles.link} ${styles.active}` : styles.link}>
          About
        </NavLink>
      </nav>
    </header>
  )
}
